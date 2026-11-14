import { describe, it, expect } from "vitest";
import type { Action, Vehicle } from "@contract/types";
import { approvalRow } from "./approvals";

const action = { _id: "A-3", run_id: "R-1", agent_id: "controller-1", type: "route_request", payload: { vehicle_id: "V-1", edges: ["E10"] }, decision: "needs_approval", policy_ids: ["P-runway-crossing"], reason: "Route crosses active runway", ts: "t" } as Action;
const vehicle = { _id: "V-1", kind: "aircraft", details: { flight: "AC101", gate: "G5" } } as unknown as Vehicle;

describe("approvalRow", () => {
  it("names the flight and the gate", () => {
    expect(approvalRow(action, { "V-1": vehicle }, { G5: "Gate 5" })).toEqual({
      id: "A-3", title: "AC101 → Gate 5", reason: "Route crosses active runway", policyIds: ["P-runway-crossing"],
    });
  });
  it("falls back to the vehicle id when the vehicle is not in state", () => {
    expect(approvalRow(action, {}, {}).title).toBe("V-1");
  });
  it("falls back to the node id when the gate name is unknown", () => {
    expect(approvalRow(action, { "V-1": vehicle }, {}).title).toBe("AC101 → G5");
  });
});
