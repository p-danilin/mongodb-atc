import type { Action, Vehicle } from "@contract/types";

export interface ApprovalRow {
  id: string;
  /** "AC101 → Gate 5", or the vehicle id when it is not known yet. */
  title: string;
  reason: string;
  policyIds: string[];
}

/** What a queue row shows. Pure, so it is tested without a browser. */
export function approvalRow(action: Action, vehicles: Record<string, Vehicle>, gateNames: Record<string, string>): ApprovalRow {
  const v = vehicles[action.payload.vehicle_id];
  const d = v?.details as { flight?: string; gate?: string } | undefined;
  const who = d?.flight ?? action.payload.vehicle_id;
  const to = d?.gate ? gateNames[d.gate] ?? d.gate : null;
  return { id: action._id, title: to ? `${who} → ${to}` : who, reason: action.reason, policyIds: action.policy_ids };
}
