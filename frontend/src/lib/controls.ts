import type { Action, Run, Vehicle, Zone } from "@contract/types";

export interface Control { enabled: boolean; reason?: string }

export const RESUME_FIRST = "Resume the run first";
const RED_TEAM_NEEDS = "Drop a closure and spawn a flight first";

const whileRunning = (run: Run): Control => (run.status === "halted" ? { enabled: false, reason: RESUME_FIRST } : { enabled: true });

export const spawnControl = whileRunning;
/** Approve and Deny. */
export const resolveControl = whileRunning;

/** Stays enabled while halted: the policy then refuses the route because the run is halted. */
export function redTeamControl(_run: Run, vehicles: Record<string, Vehicle>, zones: Zone[]): Control {
  return Object.keys(vehicles).length && zones.length ? { enabled: true } : { enabled: false, reason: RED_TEAM_NEEDS };
}

export function approvalsChip(pending: Action[]): string | null {
  return pending.length ? `${pending.length} approval${pending.length === 1 ? "" : "s"} waiting` : null;
}
