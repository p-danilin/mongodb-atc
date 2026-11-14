import { describe, it, expect } from "vitest";
import type { Snapshot, Vehicle, WsMessage, Run } from "@contract/types";
import seed from "@contract/seed.json";
import { createSync, type Transport, type ConnectionStatus } from "./sync";

const run = seed.run as Run;
const veh = (id: string, over: Partial<Vehicle> = {}) => ({ ...(seed.vehicles[0] as unknown as Vehicle), _id: id, ...over }) as Vehicle;
const moved = (seq: number, vehicle: Vehicle = veh("V-1")): WsMessage => ({ type: "vehicle.moved", seq, ts: "t", data: vehicle });
const snapAt = (seq: number, vehicles: Vehicle[] = []): Snapshot => ({ seq, vehicles, zones: [], pending_approvals: [], run });

function harness(opts: { snapshots?: Snapshot[] } = {}) {
  const pending: Array<(s: Snapshot) => void> = [];
  const timers: Array<() => void> = [];
  let handlers!: Parameters<Transport["connect"]>[0];
  let connects = 0, fetches = 0, closes = 0;
  const transport: Transport = {
    fetchSnapshot: () => { fetches++; return new Promise((res) => pending.push(res)); },
    connect: (h) => { connects++; handlers = h; return { close: () => { closes++; } }; },
  };
  const log: string[] = [];
  const statuses: ConnectionStatus[] = [];
  const sync = createSync({
    transport,
    onSnapshot: (s) => log.push(`snap:${s.seq}:${s.vehicles.map((v) => v._id).join(",")}`),
    onMessage: (m) => log.push(`msg:${m.seq}`),
    onStatus: (s) => statuses.push(s),
    schedule: (fn) => { timers.push(fn); return () => {}; },
  });
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return {
    sync, log, statuses, handlers: () => handlers, counts: () => ({ connects, fetches, closes }),
    resolveSnapshot: async (s: Snapshot) => { pending.shift()!(s); await flush(); },
    runTimers: () => { const t = timers.splice(0); t.forEach((f) => f()); },
    open: () => handlers.onOpen(), send: (m: WsMessage) => handlers.onMessage(m), close: () => handlers.onClose(),
  };
}

describe("sync", () => {
  it("buffers messages that arrive before the snapshot, drops seq <= snapshot.seq, applies the rest in order", async () => {
    const h = harness();
    h.sync.start(); h.open();
    h.send(moved(4)); h.send(moved(5)); h.send(moved(6)); h.send(moved(7));
    expect(h.log).toEqual([]);
    expect(h.statuses.at(-1)).toBe("resyncing");
    await h.resolveSnapshot(snapAt(5));
    expect(h.log).toEqual(["snap:5:", "msg:6", "msg:7"]);
    expect(h.statuses.at(-1)).toBe("connected");
  });
  it("applies live messages in order once connected and ignores duplicates", async () => {
    const h = harness();
    h.sync.start(); h.open(); await h.resolveSnapshot(snapAt(1));
    h.send(moved(2)); h.send(moved(2)); h.send(moved(3));
    expect(h.log).toEqual(["snap:1:", "msg:2", "msg:3"]);
    expect(h.counts().fetches).toBe(1);
  });
  it("a seq gap triggers one refetch and the gapped message is not applied before the snapshot", async () => {
    const h = harness();
    h.sync.start(); h.open(); await h.resolveSnapshot(snapAt(1));
    h.send(moved(2)); h.send(moved(4));
    expect(h.counts().fetches).toBe(2);
    expect(h.statuses.at(-1)).toBe("resyncing");
    await h.resolveSnapshot(snapAt(3, [veh("V-1")]));
    expect(h.log).toEqual(["snap:1:", "msg:2", "snap:3:V-1", "msg:4"]);
    expect(h.statuses.at(-1)).toBe("connected");
  });
  it("repeated gaps during a resync do not start extra fetches", async () => {
    const h = harness();
    h.sync.start(); h.open(); await h.resolveSnapshot(snapAt(1));
    h.send(moved(5)); h.send(moved(9)); h.send(moved(12));
    expect(h.counts().fetches).toBe(2);
    await h.resolveSnapshot(snapAt(12));
    expect(h.counts().fetches).toBe(2);
    expect(h.log).toEqual(["snap:1:", "snap:12:"]);
  });
  it("sim.reset triggers a refetch", async () => {
    const h = harness();
    h.sync.start(); h.open(); await h.resolveSnapshot(snapAt(1, [veh("V-1")]));
    h.send({ type: "sim.reset", seq: 2, ts: "t", data: run });
    expect(h.counts().fetches).toBe(2);
    await h.resolveSnapshot(snapAt(2, []));
    expect(h.log.at(-1)).toBe("snap:2:");
    expect(h.statuses.at(-1)).toBe("connected");
  });
  it("disconnect shows disconnected, reconnects with backoff, and refetches", async () => {
    const h = harness();
    h.sync.start(); h.open(); await h.resolveSnapshot(snapAt(1));
    h.close();
    expect(h.statuses.at(-1)).toBe("disconnected");
    expect(h.counts().connects).toBe(1);
    h.runTimers();
    expect(h.counts().connects).toBe(2);
    h.open();
    expect(h.counts().fetches).toBe(2);
    h.send(moved(3));
    await h.resolveSnapshot(snapAt(2, [veh("V-1")]));
    expect(h.log.slice(-2)).toEqual(["snap:2:V-1", "msg:3"]);
    expect(h.statuses.at(-1)).toBe("connected");
  });
  it("a snapshot that finishes after a newer disconnect is ignored", async () => {
    const h = harness();
    h.sync.start(); h.open();
    h.close();
    await h.resolveSnapshot(snapAt(1));
    expect(h.log).toEqual([]);
    expect(h.statuses.at(-1)).toBe("disconnected");
  });
  it("no duplicate vehicle after resync (snapshot is authoritative)", async () => {
    const h = harness();
    h.sync.start(); h.open();
    h.send(moved(3, veh("V-1")));
    await h.resolveSnapshot(snapAt(3, [veh("V-1")]));
    expect(h.log).toEqual(["snap:3:V-1"]);
  });
  it("stop closes the socket and stops reconnecting", async () => {
    const h = harness();
    h.sync.start(); h.open(); h.sync.stop();
    expect(h.counts().closes).toBe(1);
    h.runTimers();
    expect(h.counts().connects).toBe(1);
  });
});
