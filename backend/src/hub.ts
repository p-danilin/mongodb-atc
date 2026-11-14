import type { WsMessage } from "../../docs/contract/types";

export interface Client { send(data: string): void }

/** Websocket fan-out. Owns the server-wide `seq` from the contract: +1 per message, a gap means "refetch". */
export class Hub {
  seq = 0;
  private clients = new Set<Client>();
  private skip = 0;

  add(c: Client) { this.clients.add(c); }
  remove(c: Client) { this.clients.delete(c); }

  /** Burn a seq number so every client sees a gap and refetches the snapshot (used after a stream restart). */
  forceGap() { this.skip += 1; }

  emit<T extends WsMessage["type"]>(type: T, data: Extract<WsMessage, { type: T }>["data"]) {
    this.seq += 1 + this.skip;
    this.skip = 0;
    const text = JSON.stringify({ type, seq: this.seq, ts: new Date().toISOString(), data });
    for (const c of this.clients) {
      try { c.send(text); } catch { this.clients.delete(c); }
    }
  }
}
