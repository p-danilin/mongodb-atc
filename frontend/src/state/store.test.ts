import { describe, it, expect } from "vitest";
import type { Action, LedgerEntry, Run, Snapshot, WsMessage } from "@contract/types";
import { createStore } from "./store";

const run = (id: string) => ({ _id: id, status: "running", started_at: "t" }) as Run;
const snap = (id: string): Snapshot => ({ seq: 1, vehicles: [], zones: [], pending_approvals: [], run: run(id) });
const entry = (n: number, run_id = "R-1") => ({ _id: `${run_id}-${n}`, run_id, n, ts: "t", actor: "a", event: "vehicle.spawned", ref: { collection: "c", id: "i" }, summary: "s" }) as LedgerEntry;
const appended = (e: LedgerEntry, seq = 2) => ({ type: "ledger.appended", seq, ts: "t", data: e }) as WsMessage;

describe("store ledger", () => {
  it("shows fetched entries and live ones in order, without duplicates", () => {
    const s = createStore();
    s.snapshot(snap("R-1"));
    s.message(appended(entry(3)));
    s.loadLedger([entry(1), entry(2), entry(3)], "R-1");
    s.message(appended(entry(3), 3));
    s.message(appended(entry(4), 4));
    expect(s.getState().ledger.map((e) => e.n)).toEqual([1, 2, 3, 4]);
  });
  it("clears on sim.reset and ignores entries of another run", () => {
    const s = createStore();
    s.snapshot(snap("R-1"));
    s.loadLedger([entry(1)], "R-1");
    s.message({ type: "sim.reset", seq: 2, ts: "t", data: run("R-2") } as WsMessage);
    expect(s.getState().ledger).toEqual([]);
    s.snapshot(snap("R-2"));
    s.message(appended(entry(1, "R-1"), 3));
    expect(s.getState().ledger).toEqual([]);
    s.message(appended(entry(1, "R-2"), 4));
    expect(s.getState().ledger).toHaveLength(1);
  });
  it("drops a selected closure the server has expired", () => {
    const s = createStore();
    s.snapshot({ ...snap("R-1"), zones: [{ _id: "Z-1" } as never] });
    s.selectZone("Z-1");
    s.message({ type: "zone.expired", seq: 2, ts: "t", data: { _id: "Z-1" } } as WsMessage);
    expect(s.getState().selectedZone).toBeNull();
  });
  it("keeps UI state across snapshots, and only the red team sets the alert", () => {
    const s = createStore();
    s.setTab("approvals");
    s.snapshot(snap("R-1"));
    s.message({ type: "action.decided", seq: 2, ts: "t", data: { decision: "deny", payload: { vehicle_id: "V", edges: [] } } as unknown as Action } as WsMessage);
    expect(s.getState().tab).toBe("approvals");
    expect(s.getState().redTeamAlert).toBeNull();
  });
});
