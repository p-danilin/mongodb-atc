import { describe, it, expect } from "vitest";
import seed from "@contract/seed.json";
import type { Vehicle, Zone, Action, Run, WsMessage, Snapshot, LedgerEntry, Resolution } from "@contract/types";
import { initialState, applySnapshot, applyMessage } from "./reducer";

const v = (over: Partial<Vehicle> = {}) => ({ ...(seed.vehicles[0] as unknown as Vehicle), ...over }) as Vehicle;
const zone = { ...(seed.sample_zone as Zone) };
const action = { _id: "A-1", run_id: "R-1", agent_id: "controller-1", type: "route_request", payload: { vehicle_id: "V-1", edges: ["E10"] }, decision: "needs_approval", policy_ids: ["p"], reason: "x", ts: "t" } as Action;
const run = seed.run as Run;
const msg = <T extends WsMessage>(m: Omit<T, "seq" | "ts"> & Partial<T>) => ({ seq: 1, ts: "t", ...m }) as T;
const snap: Snapshot = { seq: 5, vehicles: [v()], zones: [zone], pending_approvals: [action], run };

describe("reducer", () => {
  it("snapshot replaces everything and records seq", () => {
    const s = applySnapshot(applyMessage(initialState, msg({ type: "vehicle.spawned", data: v({ _id: "V-9" }) })), snap);
    expect(Object.keys(s.vehicles)).toEqual(["V-1"]);
    expect(s.zones).toHaveLength(1);
    expect(s.pendingApprovals).toHaveLength(1);
    expect(s.run.status).toBe("running");
    expect(s.seq).toBe(5);
  });
  it("vehicle.spawned / moved replace by _id idempotently", () => {
    const m = msg({ type: "vehicle.moved", data: v({ heading: 90, status: "moving" }) });
    const once = applyMessage(applySnapshot(initialState, snap), m);
    const twice = applyMessage(once, m);
    expect(twice.vehicles).toEqual(once.vehicles);
    expect(Object.keys(twice.vehicles)).toHaveLength(1);
    expect(twice.vehicles["V-1"].heading).toBe(90);
    const sp = applyMessage(initialState, msg({ type: "vehicle.spawned", data: v() }));
    expect(sp.vehicles["V-1"]).toBeDefined();
  });
  it("moved replaces route and status wholesale", () => {
    const s = applyMessage(applyMessage(initialState, msg({ type: "vehicle.spawned", data: v({ route: ["E1"], status: "moving" }) })),
      msg({ type: "vehicle.moved", data: v({ route: [], status: "idle" }) }));
    expect(s.vehicles["V-1"].route).toEqual([]);
    expect(s.vehicles["V-1"].status).toBe("idle");
  });
  it("zones created, expired, removed", () => {
    let s = applyMessage(initialState, msg({ type: "zone.created", data: zone }));
    s = applyMessage(s, msg({ type: "zone.created", data: zone }));
    expect(s.zones).toHaveLength(1);
    expect(applyMessage(s, msg({ type: "zone.expired", data: { _id: zone._id } })).zones).toHaveLength(0);
    expect(applyMessage(s, msg({ type: "zone.removed", data: { _id: zone._id } })).zones).toHaveLength(0);
  });
  it("approvals requested and resolved", () => {
    let s = applyMessage(initialState, msg({ type: "approval.requested", data: action }));
    s = applyMessage(s, msg({ type: "approval.requested", data: action }));
    expect(s.pendingApprovals).toHaveLength(1);
    const res = { _id: "RS-1", run_id: "R-1", resolves: "A-1", decision: "approve", resolved_by: "supervisor-1", ts: "t" } as Resolution;
    expect(applyMessage(s, msg({ type: "approval.resolved", data: res })).pendingApprovals).toHaveLength(0);
  });
  it("run halted / resumed flip status", () => {
    const s = applyMessage(initialState, msg({ type: "run.halted", data: { ...run, status: "halted" } }));
    expect(s.run.status).toBe("halted");
    expect(applyMessage(s, msg({ type: "run.resumed", data: run })).run.status).toBe("running");
  });
  it("ledger.appended, action.decided, sim.reset do not throw", () => {
    const entry = { _id: "L", run_id: "R-1", n: 1, ts: "t", actor: "a", event: "run.halted", ref: { collection: "c", id: "i" }, summary: "s" } as LedgerEntry;
    expect(() => applyMessage(initialState, msg({ type: "ledger.appended", data: entry }))).not.toThrow();
    expect(() => applyMessage(initialState, msg({ type: "action.decided", data: action }))).not.toThrow();
    expect(() => applyMessage(initialState, msg({ type: "sim.reset", data: run }))).not.toThrow();
    expect(() => applyMessage(initialState, { type: "future.thing", seq: 1, ts: "t", data: {} } as unknown as WsMessage)).not.toThrow();
  });
  it("tracks last applied seq", () => {
    expect(applyMessage(initialState, msg({ type: "run.resumed", data: run, seq: 42 })).seq).toBe(42);
  });
});
