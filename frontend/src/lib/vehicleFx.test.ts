import { describe, it, expect } from "vitest";
import type { WsMessage } from "@contract/types";
import { fxFrame, flashTarget, FLASH_MS } from "./vehicleFx";

const decided = (decision: string, vehicle_id = "V-2") =>
  ({ type: "action.decided", seq: 1, ts: "t", data: { decision, payload: { vehicle_id, edges: [] } } }) as unknown as WsMessage;

describe("flashTarget", () => {
  it("names the vehicle of a denied route", () => expect(flashTarget(decided("deny"))).toBe("V-2"));
  it("ignores allow and needs_approval", () => {
    expect(flashTarget(decided("allow"))).toBeNull();
    expect(flashTarget(decided("needs_approval"))).toBeNull();
  });
  it("ignores other messages", () => expect(flashTarget({ type: "sim.reset", seq: 1, ts: "t", data: {} } as unknown as WsMessage)).toBeNull());
});

describe("fxFrame", () => {
  it("is still for a moving vehicle", () => {
    expect(fxFrame("moving", null, 1000)).toEqual({ ring: 0, flash: 0, animating: false });
  });
  it("pulses an amber ring while awaiting approval, and keeps animating", () => {
    const a = fxFrame("awaiting_approval", null, 0), b = fxFrame("awaiting_approval", null, 500);
    expect(a.animating).toBe(true);
    expect(a.ring).toBeGreaterThan(0);
    expect(a.ring).not.toBe(b.ring);
  });
  it("flashes red for about a second then stops", () => {
    expect(fxFrame("idle", 1000, 1000).flash).toBe(1);
    expect(fxFrame("idle", 1000, 1000 + FLASH_MS / 2)).toMatchObject({ animating: true });
    expect(fxFrame("idle", 1000, 1000 + FLASH_MS / 2).flash).toBeCloseTo(0.5);
    expect(fxFrame("idle", 1000, 1000 + FLASH_MS)).toEqual({ ring: 0, flash: 0, animating: false });
  });
});
