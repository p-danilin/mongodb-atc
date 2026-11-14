import type { VehicleStatus, WsMessage } from "@contract/types";

export const FLASH_MS = 1000;
const PULSE_MS = 1200;

/** The vehicle to flash for a message: only a denied route names one. */
export function flashTarget(m: WsMessage): string | null {
  return m.type === "action.decided" && m.data.decision === "deny" ? m.data.payload.vehicle_id : null;
}

export interface FxFrame {
  /** Amber ring opacity, 0 when hidden. */
  ring: number;
  /** Red flash opacity, 1 fading to 0. */
  flash: number;
  /** Whether the loop must keep running for this vehicle. */
  animating: boolean;
}

/** What to draw around one vehicle at `now`. Pure; the motion loop writes the result to the DOM. */
export function fxFrame(status: VehicleStatus, flashStart: number | null, now: number): FxFrame {
  const ring = status === "awaiting_approval" ? 0.35 + 0.55 * (0.5 + 0.5 * Math.sin((now / PULSE_MS) * 2 * Math.PI)) : 0;
  const age = flashStart === null ? FLASH_MS : now - flashStart;
  const flash = age >= FLASH_MS ? 0 : Math.max(0, 1 - Math.max(0, age) / FLASH_MS);
  return { ring, flash, animating: status === "awaiting_approval" || flash > 0 };
}
