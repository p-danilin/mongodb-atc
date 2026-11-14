/**
 * Ground Control contract: shared types.
 *
 * Source of truth for what crosses the API and the websocket. Terms are defined in /CONTEXT.md;
 * decisions are in ./README.md. Changing this file means telling the other person first.
 *
 * Conventions
 * - Coordinates are GeoJSON `[longitude, latitude]` everywhere.
 * - Timestamps are ISO 8601 strings over the wire (Mongo stores them as Date).
 * - `_id` is a string on every document.
 */

// ---------------------------------------------------------------- GeoJSON

export type Position = [lon: number, lat: number];
export interface Point { type: "Point"; coordinates: Position }
export interface LineString { type: "LineString"; coordinates: Position[] }
/** First ring is the outer ring and must be closed (first position equals last). */
export interface Polygon { type: "Polygon"; coordinates: Position[][] }

/** [minLon, minLat, maxLon, maxLat] */
export type Bounds = [number, number, number, number];

// ---------------------------------------------------------------- Ids

export type NodeId = string; // e.g. "G1", "J2"
export type EdgeId = string; // e.g. "E2"
export type VehicleId = string; // e.g. "V-1"
export type ZoneId = string; // e.g. "Z-014"
export type ActionId = string; // e.g. "A-0231"
export type IdentityId = string; // e.g. "controller-1", "supervisor-1", "I-AC101"
export type RunId = string; // e.g. "R-1"
export type ISODate = string;

// ---------------------------------------------------------------- Airport graph

export type NodeType = "gate" | "junction" | "runway_exit";

export interface GraphNode {
  _id: NodeId;
  type: NodeType;
  name: string;
  location: Point;
}

/** `runway` edges are active-runway occupancy; `runway_crossing` edges cross one. Both need approval. */
export type EdgeKind = "taxiway" | "apron" | "runway" | "runway_crossing";

export interface GraphEdge {
  _id: EdgeId;
  from: NodeId;
  to: NodeId;
  kind: EdgeKind;
  name: string;
  geometry: LineString;
  length_m: number;
}

export interface Graph {
  bounds: Bounds;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ---------------------------------------------------------------- Identities and runs

export type IdentityKind = "agent" | "vehicle" | "human";

export interface Identity {
  _id: IdentityId;
  kind: IdentityKind;
  name: string;
  clearances: string[];
  active: boolean;
}

export type RunStatus = "running" | "halted";

export interface Run {
  _id: RunId;
  status: RunStatus;
  started_at: ISODate;
  halted_by?: IdentityId;
  halted_at?: ISODate;
}

// ---------------------------------------------------------------- Vehicles

export type VehicleKind = "aircraft" | "fuel_truck" | "tug";

/** `idle`: parked or waiting. `moving`: on an approved route. `awaiting_approval`: blocked on a human. `halted`: run stopped. */
export type VehicleStatus = "idle" | "moving" | "awaiting_approval" | "halted";

export interface VehicleBase {
  _id: VehicleId;
  identity_id: IdentityId;
  run_id: RunId;
  position: Point;
  /** Degrees, 0 = north, clockwise. Held at the last value when stationary. */
  heading: number;
  /** Planned path, in order. Empty when there is none. */
  route: EdgeId[];
  status: VehicleStatus;
  /** Server time of the last write to this document. Used by the UI to interpolate. */
  ts: ISODate;
}

export interface AircraftVehicle extends VehicleBase {
  kind: "aircraft";
  details: { flight: string; gate: NodeId };
}

// Level 3. Details are placeholders until we get there.
export interface FuelTruckVehicle extends VehicleBase {
  kind: "fuel_truck";
  details: { target_vehicle_id?: VehicleId };
}

export interface TugVehicle extends VehicleBase {
  kind: "tug";
  details: { target_vehicle_id?: VehicleId };
}

export type Vehicle = AircraftVehicle | FuelTruckVehicle | TugVehicle;

// ---------------------------------------------------------------- Zones

export type ZoneType = "closure";

export interface Zone {
  _id: ZoneId;
  type: ZoneType;
  reason: string;
  geometry: Polygon;
  created_by: IdentityId;
  /** Mongo's TTL index deletes the zone at this time. */
  expires_at: ISODate;
}

// ---------------------------------------------------------------- Actions, approvals, ledger

export type Decision = "allow" | "deny" | "needs_approval";

export interface RouteRequestPayload {
  vehicle_id: VehicleId;
  edges: EdgeId[];
}

/** What the policy gate writes for every proposed action. Never updated after insert. */
export interface Action {
  _id: ActionId;
  run_id: RunId;
  agent_id: IdentityId;
  type: "route_request";
  payload: RouteRequestPayload;
  decision: Decision;
  /** At least one. The validator rejects an action without a decision or policy reference. */
  policy_ids: string[];
  reason: string;
  ts: ISODate;
}

/** Appended when a human approves or denies a `needs_approval` action. The action itself is never changed. */
export interface Resolution {
  _id: string;
  run_id: RunId;
  resolves: ActionId;
  decision: "approve" | "deny";
  resolved_by: IdentityId;
  note?: string;
  ts: ISODate;
}

export type LedgerEvent =
  | "vehicle.spawned"
  | "action.decided"
  | "approval.resolved"
  | "route.replanned"
  | "zone.created"
  | "zone.expired"
  | "zone.removed"
  | "run.halted"
  | "run.resumed";

/** Append-only. Positions are not ledgered. */
export interface LedgerEntry {
  _id: string;
  run_id: RunId;
  /** Per-run ordering. Not the websocket `seq`. */
  n: number;
  ts: ISODate;
  actor: IdentityId;
  event: LedgerEvent;
  ref: { collection: string; id: string };
  /** One human-readable line, e.g. "Route for AC101 denied: crosses closure Z-014". */
  summary: string;
}

// ---------------------------------------------------------------- Snapshot

/** `GET /api/state`. `seq` is the websocket counter when the snapshot was taken. */
export interface Snapshot {
  seq: number;
  vehicles: Vehicle[];
  zones: Zone[];
  pending_approvals: Action[];
  run: Run;
}

// ---------------------------------------------------------------- Websocket

export interface Envelope<T extends string, D> {
  type: T;
  /** Server-wide counter, +1 per message. A gap means refetch the snapshot. */
  seq: number;
  ts: ISODate;
  data: D;
}

export type WsMessage =
  | Envelope<"vehicle.spawned", Vehicle>
  /** Fires on any update to a vehicle document: position, heading, route or status. */
  | Envelope<"vehicle.moved", Vehicle>
  | Envelope<"zone.created", Zone>
  /** Removed by TTL. */
  | Envelope<"zone.expired", { _id: ZoneId }>
  /** Removed early by `DELETE /api/zones/:id`. */
  | Envelope<"zone.removed", { _id: ZoneId }>
  | Envelope<"action.decided", Action>
  | Envelope<"approval.requested", Action>
  | Envelope<"approval.resolved", Resolution>
  | Envelope<"run.halted", Run>
  | Envelope<"run.resumed", Run>
  /** The scenario was reset. Refetch the snapshot. */
  | Envelope<"sim.reset", Run>
  | Envelope<"ledger.appended", LedgerEntry>;

export type WsMessageType = WsMessage["type"];

// ---------------------------------------------------------------- Requests

export interface CreateZoneRequest {
  type: ZoneType;
  geometry: Polygon;
  ttl_seconds: number;
  reason: string;
}

export interface SpawnFlightRequest {
  gate: NodeId;
  /** Server generates one if omitted. */
  flight?: string;
}

export interface ResolveApprovalRequest {
  decision: "approve" | "deny";
  note?: string;
}

export interface HaltRequest {
  reason?: string;
}

export interface ApiError {
  error: { code: string; message: string };
}
