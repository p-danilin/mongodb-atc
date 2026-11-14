import { describe, it, expect } from "vitest";
import type { Action, Run, Vehicle, Zone } from "@contract/types";
import { spawnControl, resolveControl, redTeamControl, approvalsChip, RESUME_FIRST } from "./controls";

const running = { _id: "R-1", status: "running", started_at: "t" } as Run;
const halted = { ...running, status: "halted" } as Run;
const veh = { V1: {} as Vehicle };
const zones = [{ _id: "Z-1" } as Zone];

describe("derived controls", () => {
  it("spawn, approve and deny are enabled while running", () => {
    expect(spawnControl(running)).toEqual({ enabled: true });
    expect(resolveControl(running)).toEqual({ enabled: true });
  });
  it("spawn, approve and deny are disabled while halted, with the reason", () => {
    expect(spawnControl(halted)).toEqual({ enabled: false, reason: RESUME_FIRST });
    expect(resolveControl(halted)).toEqual({ enabled: false, reason: RESUME_FIRST });
    expect(RESUME_FIRST).toBe("Resume the run first");
  });
  it("red team needs a closure and a vehicle", () => {
    const why = "Drop a closure and spawn a flight first";
    expect(redTeamControl(running, {}, [])).toEqual({ enabled: false, reason: why });
    expect(redTeamControl(running, veh, [])).toEqual({ enabled: false, reason: why });
    expect(redTeamControl(running, {}, zones)).toEqual({ enabled: false, reason: why });
    expect(redTeamControl(running, veh, zones)).toEqual({ enabled: true });
  });
  it("red team stays enabled while halted", () => {
    expect(redTeamControl(halted, veh, zones)).toEqual({ enabled: true });
  });
  it("header chip text: hidden at zero, singular, plural", () => {
    expect(approvalsChip([])).toBeNull();
    expect(approvalsChip([{} as Action])).toBe("1 approval waiting");
    expect(approvalsChip([{} as Action, {} as Action])).toBe("2 approvals waiting");
  });
});
