import type { Action, Run, Snapshot, Vehicle, WsMessage, Zone } from "@contract/types";

export interface AppState {
  seq: number;
  vehicles: Record<string, Vehicle>;
  zones: Zone[];
  pendingApprovals: Action[];
  run: Run;
  ready: boolean;
}

export const initialState: AppState = {
  seq: 0,
  vehicles: {},
  zones: [],
  pendingApprovals: [],
  run: { _id: "", status: "running", started_at: "" },
  ready: false,
};

export function applySnapshot(_s: AppState, snap: Snapshot): AppState {
  return {
    seq: snap.seq,
    vehicles: Object.fromEntries(snap.vehicles.map((v) => [v._id, v])),
    zones: snap.zones,
    pendingApprovals: newestFirst(snap.pending_approvals),
    run: snap.run,
    ready: true,
  };
}

/** Newest request first; the order of equal timestamps is reversed too. */
const newestFirst = (list: Action[]) =>
  list.map((a, i) => ({ a, i })).sort((x, y) => (x.a.ts < y.a.ts ? 1 : x.a.ts > y.a.ts ? -1 : y.i - x.i)).map((x) => x.a);

const upsert = <T extends { _id: string }>(list: T[], item: T) =>
  list.some((x) => x._id === item._id) ? list.map((x) => (x._id === item._id ? item : x)) : [...list, item];

export function applyMessage(s: AppState, m: WsMessage): AppState {
  const next = { ...s, seq: m.seq };
  switch (m.type) {
    case "vehicle.spawned":
    case "vehicle.moved":
      return { ...next, vehicles: { ...s.vehicles, [m.data._id]: m.data } };
    case "zone.created":
      return { ...next, zones: upsert(s.zones, m.data) };
    case "zone.expired":
    case "zone.removed":
      return { ...next, zones: s.zones.filter((z) => z._id !== m.data._id) };
    case "approval.requested":
      return { ...next, pendingApprovals: s.pendingApprovals.some((a) => a._id === m.data._id) ? upsert(s.pendingApprovals, m.data) : [m.data, ...s.pendingApprovals] };
    case "approval.resolved":
      return { ...next, pendingApprovals: s.pendingApprovals.filter((a) => a._id !== m.data.resolves) };
    case "run.halted":
    case "run.resumed":
      return { ...next, run: m.data };
    default:
      // action.decided, ledger.appended, sim.reset (handled by sync) and unknown future types
      return next;
  }
}
