import type { ChangeStream, ChangeStreamDocument, ResumeToken } from "mongodb";
import type { Database, Doc } from "./db";
import { wire } from "./db";
import type { Hub } from "./hub";

/**
 * Relays Mongo change-stream events to the websocket, so the map shows what the database says.
 *
 * One database-level stream (not one per collection) gives a single total order across collections:
 * a reset's vehicle deletes always arrive before the new run's insert, so `sim.reset` can never be
 * overtaken by a stale `vehicle.moved`.
 */
export function startRelay(database: Database, hub: Hub) {
  let stream: ChangeStream<Doc> | null = null;
  let token: ResumeToken | undefined;
  let stopped = false;

  function relay(ev: ChangeStreamDocument<Doc>) {
    if (!("ns" in ev) || !("coll" in ev.ns)) return;
    const coll = ev.ns.coll;
    const op = ev.operationType;
    const doc = "fullDocument" in ev && ev.fullDocument ? wire(ev.fullDocument) : null;

    if (coll === "vehicles") {
      // A null document on update means it was deleted before the lookup (a reset); the delete needs no event.
      if (op === "insert" && doc) hub.emit("vehicle.spawned", doc);
      else if ((op === "update" || op === "replace") && doc) hub.emit("vehicle.moved", doc);
    } else if (coll === "runs") {
      // A new run document is a scenario reset; a status change on the current one is the kill switch.
      if (op === "insert" && doc) hub.emit("sim.reset", doc);
      else if ((op === "update" || op === "replace") && doc) hub.emit(doc.status === "halted" ? "run.halted" : "run.resumed", doc);
    }
    // Level 1 adds zones (created / expired / removed); Level 2 adds actions, approvals and ledger.
  }

  function open() {
    if (stopped) return;
    stream = database.db.watch<Doc>(
      [{ $match: { "ns.coll": { $in: ["vehicles", "runs", "zones", "actions", "ledger"] } } }],
      { fullDocument: "updateLookup", ...(token ? { resumeAfter: token } : {}) },
    );
    stream.on("change", (ev) => { token = ev._id; relay(ev); });
    stream.on("error", (err) => {
      console.error("change stream error, reopening:", err.message);
      stream?.close().catch(() => {});
      hub.forceGap(); // clients refetch the snapshot in case events were missed
      setTimeout(open, 1000);
    });
  }

  open();
  return { stop: async () => { stopped = true; await stream?.close(); } };
}
