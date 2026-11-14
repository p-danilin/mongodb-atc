import type { IdentityId, LedgerEvent } from "../../docs/contract/types";
import type { Database } from "./db";

/**
 * The append-only event log. Entries are only ever inserted; `n` orders them within a run.
 * Appends are queued so `n` matches the order the events were recorded in.
 */
export class Ledger {
  private runId = "";
  private n = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private database: Database) {}

  /** Point the ledger at a run and continue its numbering. */
  async open(runId: string) {
    await this.queue;
    const last = await this.database.col.ledger.find({ run_id: runId }).sort({ n: -1 }).limit(1).next();
    this.runId = runId;
    this.n = last?.n ?? 0;
  }

  append(actor: IdentityId, event: LedgerEvent, ref: { collection: string; id: string }, summary: string): Promise<void> {
    const run_id = this.runId;
    const n = ++this.n;
    const write = this.queue.then(() =>
      this.database.col.ledger.insertOne({ _id: `${run_id}-L${String(n).padStart(4, "0")}`, run_id, n, ts: new Date(), actor, event, ref, summary }),
    );
    this.queue = write.catch((e) => console.error("ledger append failed:", e.message));
    return write.then(() => undefined);
  }
}
