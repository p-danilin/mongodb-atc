import type { Snapshot, WsMessage } from "@contract/types";

export type ConnectionStatus = "connected" | "resyncing" | "disconnected";

export interface Transport {
  fetchSnapshot(): Promise<Snapshot>;
  connect(h: { onOpen(): void; onMessage(m: WsMessage): void; onClose(): void }): { close(): void };
}

export interface SyncOptions {
  transport: Transport;
  onSnapshot(s: Snapshot): void;
  onMessage(m: WsMessage): void;
  onStatus(s: ConnectionStatus): void;
  /** Runs `fn` after `ms`; returns a cancel function. Injectable for tests. */
  schedule?: (fn: () => void, ms: number) => () => void;
}

const defaultSchedule = (fn: () => void, ms: number) => {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
};

/**
 * Client rules from docs/contract/api.md: buffer while the snapshot loads, drop seq <= snapshot.seq,
 * apply the rest in order, refetch on a gap, on reconnect and on sim.reset.
 */
export function createSync(opts: SyncOptions) {
  const schedule = opts.schedule ?? defaultSchedule;
  let running = false;
  let socket: { close(): void } | null = null;
  let cancelTimer: (() => void) | null = null;
  let status: ConnectionStatus = "disconnected";
  let lastSeq = -1;
  let resyncing = false;
  let buffer: WsMessage[] = [];
  let generation = 0; // bumped on every disconnect so a late snapshot is ignored
  let attempts = 0;

  const setStatus = (s: ConnectionStatus) => {
    if (s !== status) { status = s; opts.onStatus(s); }
  };

  function resync() {
    if (resyncing) return;
    resyncing = true;
    setStatus("resyncing");
    const gen = generation;
    opts.transport.fetchSnapshot().then(
      (snap) => {
        if (gen !== generation || !running) return;
        opts.onSnapshot(snap);
        lastSeq = snap.seq;
        const pending = buffer.filter((m) => m.seq > snap.seq).sort((a, b) => a.seq - b.seq);
        buffer = [];
        resyncing = false;
        setStatus("connected");
        for (const m of pending) handle(m);
      },
      () => {
        if (gen !== generation || !running) return;
        resyncing = false;
        buffer = [];
        retryLater();
      },
    );
  }

  function handle(m: WsMessage) {
    if (resyncing) { buffer.push(m); return; }
    if (m.seq <= lastSeq) return; // duplicate or stale
    if (m.seq !== lastSeq + 1) { buffer.push(m); resync(); return; } // gap
    lastSeq = m.seq;
    if (m.type === "sim.reset") { opts.onMessage(m); resync(); return; }
    opts.onMessage(m);
  }

  function retryLater() {
    setStatus("disconnected");
    const ms = Math.min(500 * 2 ** attempts, 5000);
    attempts++;
    cancelTimer?.();
    cancelTimer = schedule(() => { cancelTimer = null; if (running) open(); }, ms);
  }

  function open() {
    socket?.close();
    socket = opts.transport.connect({
      onOpen: () => { attempts = 0; resync(); },
      onMessage: handle,
      onClose: () => {
        generation++;
        resyncing = false;
        buffer = [];
        socket = null;
        if (running) retryLater();
      },
    });
  }

  return {
    start() { if (running) return; running = true; open(); },
    stop() {
      running = false; generation++;
      cancelTimer?.(); cancelTimer = null;
      socket?.close(); socket = null;
      setStatus("disconnected");
    },
  };
}
