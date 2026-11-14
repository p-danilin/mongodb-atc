import seed from "../../docs/contract/seed.json" with { type: "json" };
import type {
  Action, Bounds, CreateZoneRequest, EdgeId, Graph, LedgerEntry, NodeId, Position, ResolveApprovalRequest, Resolution, Run, Snapshot, Vehicle, Zone,
} from "../../docs/contract/types";
import { config } from "./config";
import { wire, type Database, type Doc } from "./db";
import { Gate, holdsGate, type Verdict } from "./gate";
import type { Hub } from "./hub";
import type { Ledger } from "./ledger";
import { buildPlan, distM, findRoute, lengthM, orientRoute, oriented, planFrom, splitAt, type Plan, type Step } from "./planner";
import type { Sim, Where } from "./sim";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

/** The airport graph, read from Mongo (seeded by `npm run seed`). Bounds come from the contract seed. */
export async function loadGraph(database: Database): Promise<Graph> {
  const [nodes, edges] = await Promise.all([
    database.col.nodes.find().sort({ _id: 1 }).toArray(),
    database.col.edges.find().sort({ _id: 1 }).toArray(),
  ]);
  if (!nodes.length || !edges.length) throw new Error("No airport graph in Mongo. Run `npm run seed` first.");
  return { bounds: seed.graph.bounds as Bounds, nodes, edges } as unknown as Graph;
}

const num = (id: string) => Number(id.split("-")[1]) || 0;
const pad = (n: number, width: number) => String(n).padStart(width, "0");
const SUPERVISOR = "supervisor-1"; // there is no auth: the server acts as the supervisor for every human action
const CONTROLLER = "controller-1";
/** Edge kinds outside the controller's clearances. A route using one needs supervisor approval. */
const RESTRICTED = ["runway", "runway_crossing"] as const;
const MAX_TTL_S = 3600;
const ARRIVALS: NodeId = "RH1";

interface ActiveZone { doc: Doc; edges: Set<EdgeId>; timer: NodeJS.Timeout }
interface Flight { name: string; gate: NodeId }
/** Where a route starts: a vehicle standing on a node, or one part-way along an edge. */
type Origin = { node: NodeId; position: Position } | Where;
/** What came of asking for a route, in terms a controller can read back to a pilot. */
export interface TaxiOutcome {
  flight: string;
  /** `arrived`: already at the gate. `deny`: nothing is permitted, the flight holds position. */
  decision: "allow" | "needs_approval" | "deny" | "arrived";
  gate: NodeId;
  gate_name: string;
  /** Taxiway names in order, e.g. ["H1", "A", "D2", "Taxilane", "Spur 2"]. Empty unless a route was requested. */
  route: string[];
  action_id?: string;
  policy_ids?: string[];
  reason?: string;
  /** Set when the requested gate was taken and the controller chose another. */
  reassigned_from?: string;
}

interface Candidate { first?: { line: Position[]; step: Step }; rest: Step[]; length: number; needsApproval: boolean }

/**
 * Scenario operations behind the API, and the controller's behaviour. Everything it changes, it changes
 * by writing to Mongo, and it never moves a vehicle without an `allow` from the policy gate.
 */
export class World {
  private run!: Doc;
  private nextVehicle = 1;
  private nextFlight = 101;
  private nextZone = 1;
  private nextResolution = 1;
  /** Closures in force: not yet expired, not removed. */
  private zones = new Map<string, ActiveZone>();
  private removing = new Set<string>();
  private flights = new Map<string, Flight>();
  /** Where each stationary vehicle that still wants to go somewhere is standing. */
  private parked = new Map<string, Origin>();
  /** Vehicles with no permitted route. Retried whenever a closure goes away. */
  private held = new Set<string>();
  /** Vehicles whose runway crossing a supervisor refused: do not ask again. */
  private refused = new Set<string>();
  /** State changes and the decisions they cause run one at a time. */
  private lock: Promise<unknown> = Promise.resolve();
  readonly gate: Gate;

  constructor(private database: Database, private hub: Hub, private sim: Sim, private ledger: Ledger, readonly graph: Graph) {
    this.gate = new Gate(database, graph, { run: () => this.run, activeZones: () => [...this.zones.keys()] });
  }

  // ------------------------------------------------------------------ startup

  /** Load the current run (the newest) or create the first one, then pick up what Mongo says is in progress. */
  async init() {
    const { runs, vehicles, zones, ledger, approvals } = this.database.col;
    const latest = await runs.find().sort({ started_at: -1 }).limit(1).next();
    this.run = latest ?? (await this.newRun(1));
    this.sim.halted = this.run.status === "halted";
    this.sim.runId = this.run._id;
    await Promise.all([this.ledger.open(this.run._id), this.gate.init()]);
    this.nextResolution = (await approvals.countDocuments()) + 1;

    // Zone ids stay unique across runs, because old ledger entries still refer to them.
    const pastZones = await ledger.distinct("ref.id", { "ref.collection": "zones" });
    for (const z of await zones.find().toArray()) {
      pastZones.push(z._id);
      if (z.expires_at > new Date()) this.activate(z, await this.edgesHit(z.geometry));
    }
    for (const id of pastZones) this.nextZone = Math.max(this.nextZone, num(String(id)) + 1);

    let resumed = 0;
    for (const v of await vehicles.find().toArray()) {
      this.nextVehicle = Math.max(this.nextVehicle, num(v._id) + 1);
      this.nextFlight = Math.max(this.nextFlight, (Number(String(v.details?.flight ?? "").replace(/\D/g, "")) || 100) + 1);
      if (v.kind !== "aircraft") continue;
      this.flights.set(v._id, { name: v.details.flight, gate: v.details.gate });
      const at: Position = v.position.coordinates;
      // A vehicle that was mid-taxi when the server stopped carries on from where Mongo says it is.
      const steps = v.route.length ? orientRoute(this.graph, v.route, v.details.gate) : null;
      if (steps) { this.sim.follow(v._id, planFrom(steps, at, config.stepM).plan, at); resumed++; continue; }
      if (distM(at, this.node(v.details.gate).location.coordinates) < 1) continue; // parked at its gate
      this.parked.set(v._id, this.nearest(at));
      if (v.status === "idle") this.held.add(v._id);
    }
    if (this.zones.size) await this.replanAffected();
    return { resumed, zones: this.zones.size };
  }

  // ------------------------------------------------------------------ reads

  currentRun(): Run { return wire<Run>(this.run); }
  private get halted() { return this.run.status === "halted"; }

  /** `seq` is read before Mongo, so the snapshot is never older than the seq it claims. */
  async snapshot(): Promise<Snapshot> {
    const seq = this.hub.seq;
    const [vehicles, pending] = await Promise.all([this.database.col.vehicles.find().sort({ _id: 1 }).toArray(), this.pendingApprovals()]);
    const zones = [...this.zones.values()].map((z) => z.doc);
    return { seq, vehicles: wire(vehicles), zones: wire(zones), pending_approvals: pending, run: this.currentRun() };
  }

  async ledgerFor(runId?: string): Promise<LedgerEntry[]> {
    return wire(await this.database.col.ledger.find({ run_id: runId || this.run._id }).sort({ n: 1 }).toArray());
  }

  /** Actions in this run that asked for a human and have no resolution yet. The server decides this, not the UI. */
  async pendingApprovals(): Promise<Action[]> {
    const { actions, approvals } = this.database.col;
    const resolved = await approvals.distinct("resolves", { run_id: this.run._id });
    return wire(await actions.find({ run_id: this.run._id, decision: "needs_approval", _id: { $nin: resolved } }).sort({ _id: 1 }).toArray());
  }

  // ------------------------------------------------------------------ flights

  /** An arriving flight appears at Runway exit 1. The controller then requests a route to its gate. */
  async spawnFlight(gate: NodeId, flight?: string, hold = !config.autoDispatch): Promise<Vehicle> {
    const from = this.node(ARRIVALS);
    const to = this.graph.nodes.find((n) => n._id === gate && n.type === "gate");
    if (!to) throw new HttpError(400, "bad_request", "gate must be a gate node id");
    if (this.halted) throw new HttpError(409, "halted", "The run is halted. Resume it before spawning a flight.");

    const id = `V-${this.nextVehicle++}`;
    const name = flight ?? `AC${this.nextFlight++}`;
    const identity = `I-${name}`;
    await this.database.col.identities.updateOne(
      { _id: identity },
      { $set: { kind: "vehicle", name, clearances: ["taxiway", "apron"], active: true } },
      { upsert: true },
    );
    const doc: Doc = {
      _id: id, kind: "aircraft", identity_id: identity, run_id: this.run._id,
      position: from.location, heading: 235, route: [], status: "idle", ts: new Date(), details: { flight: name, gate },
    };
    await this.database.col.vehicles.insertOne(doc);
    this.flights.set(id, { name, gate });
    this.record(SUPERVISOR, "vehicle.spawned", "vehicles", id, `${name} arrived at ${from.name}, bound for ${to.name}`);
    const origin = { node: from._id, position: from.location.coordinates };
    // Either the flight waits for its pilot to call in, or the arrival itself wakes the controller.
    // Dispatch runs after the response, so a slow decision never blocks the API.
    if (hold) this.parked.set(id, origin);
    else void this.exclusive(() => this.dispatch(id, origin));
    return wire<Vehicle>(doc);
  }

  // ------------------------------------------------------------------ pilot requests

  /**
   * A pilot asks for taxi: "Ground, AC101, request taxi to gate 2". This is the controller's main tool.
   * The request goes through the policy gate like every other, and the answer says what to read back.
   */
  async requestTaxi(callsign: string, gate?: NodeId): Promise<TaxiOutcome> {
    if (typeof callsign !== "string" || !callsign.trim()) throw new HttpError(400, "bad_request", "flight is required");
    if (gate !== undefined && !this.graph.nodes.some((n) => n._id === gate && n.type === "gate")) throw new HttpError(400, "bad_request", `gate must be one of ${this.gates().join(", ")}`);
    return this.exclusive(async () => {
      const [id, flight] = this.find(callsign);
      const vehicle = await this.database.col.vehicles.findOne({ _id: id });
      if (!vehicle) throw new HttpError(404, "not_found", `No flight ${callsign} on the ground`);
      const base = (decision: TaxiOutcome["decision"], extra: Partial<TaxiOutcome> = {}): TaxiOutcome =>
        ({ flight: flight.name, decision, gate: flight.gate, gate_name: this.node(flight.gate).name, route: [], ...extra });

      const same = gate === undefined || gate === flight.gate;
      const pending = (await this.pendingApprovals()).find((a) => a.payload.vehicle_id === id);
      if (pending && same) return base("needs_approval", { action_id: pending._id, policy_ids: pending.policy_ids, reason: `${pending.reason} (still waiting for the supervisor)`, route: this.names(pending.payload.edges.map((e) => ({ edge: this.edge(e), forward: true }))) });
      const at = this.sim.where(id);
      if (at && same) return base("allow", { reason: "already cleared and taxiing", route: this.names([at.leg, ...at.remaining]) });

      if (!same) {
        flight.gate = gate;
        this.refused.delete(id);
        await this.database.col.vehicles.updateOne({ _id: id }, { $set: { "details.gate": gate, ts: new Date() } });
      }
      if (at) this.sim.pause(id);
      const origin: Origin = this.sim.where(id) ?? this.parked.get(id) ?? this.nearest(vehicle.position.coordinates);
      return (await this.dispatch(id, origin, at ? "changed destination at the pilot's request" : undefined)) ?? base("deny", { reason: "flight is no longer on the ground" });
    });
  }

  /** Where a flight is and what it is cleared for. */
  async flightStatus(callsign: string) {
    const [id, flight] = this.find(callsign);
    const { vehicles, actions, approvals } = this.database.col;
    const [vehicle, last] = await Promise.all([
      vehicles.findOne({ _id: id }),
      actions.find({ run_id: this.run._id, "payload.vehicle_id": id }).sort({ _id: -1 }).limit(1).next(),
    ]);
    if (!vehicle) throw new HttpError(404, "not_found", `No flight ${callsign} on the ground`);
    const resolution = last?.decision === "needs_approval" ? await approvals.findOne({ resolves: last._id }) : null;
    const at = this.sim.where(id);
    return {
      flight: flight.name, status: vehicle.status as string, gate: flight.gate, gate_name: this.node(flight.gate).name,
      near: this.node(this.nearest(vehicle.position.coordinates).node).name,
      route: at ? this.names([at.leg, ...at.remaining]) : [],
      last_decision: last ? {
        action_id: last._id as string, decision: last.decision as string, policy_ids: last.policy_ids as string[], reason: last.reason as string,
        // For a `needs_approval` action: what the supervisor said, or "pending".
        ...(last.decision === "needs_approval" ? { supervisor: resolution ? (resolution.decision as string) : "pending" } : {}),
      } : null,
    };
  }

  /** The picture a controller needs before answering a pilot. */
  async airportState() {
    const [vehicles, pending] = await Promise.all([this.database.col.vehicles.find().sort({ _id: 1 }).toArray(), this.pendingApprovals()]);
    const assigned = await this.takenGates();
    return {
      run: { id: this.run._id as string, status: this.run.status as string },
      flights: vehicles.map((v) => ({
        flight: v.details?.flight as string, status: v.status as string, gate_name: this.node(v.details.gate).name,
        near: this.node(this.nearest(v.position.coordinates).node).name,
      })),
      free_gates: this.graph.nodes.filter((n) => n.type === "gate" && !assigned.has(n._id)).map((n) => ({ gate: n._id, name: n.name })),
      closures: [...this.zones.values()].map((z) => ({
        id: z.doc._id as string, reason: z.doc.reason as string, closes: [...new Set([...z.edges].map((e) => this.edge(e).name))],
        expires_in_s: Math.max(0, Math.round((z.doc.expires_at.getTime() - Date.now()) / 1000)),
      })),
      pending_approvals: pending.map((a) => ({ action_id: a._id, flight: this.flights.get(a.payload.vehicle_id)?.name ?? a.payload.vehicle_id, reason: a.reason })),
    };
  }

  private find(callsign: string): [string, Flight] {
    const want = String(callsign).replace(/[^a-z0-9]/gi, "").toUpperCase();
    const hit = [...this.flights].find(([, f]) => f.name.replace(/[^a-z0-9]/gi, "").toUpperCase() === want);
    if (!hit) throw new HttpError(404, "not_found", `No flight ${callsign} on the ground. Flights: ${[...this.flights.values()].map((f) => f.name).join(", ") || "none"}`);
    return hit;
  }

  /** Gates held by a vehicle (other than `except`): cleared to it or parked on it. */
  private async takenGates(except?: string): Promise<Set<NodeId>> {
    const gates = this.graph.nodes.filter((n) => n.type === "gate");
    const held = await Promise.all(gates.map((g) => this.database.col.vehicles.findOne({ ...(except ? { _id: { $ne: except } } : {}), ...holdsGate(g) }, { projection: { _id: 1 } })));
    return new Set(gates.filter((_, i) => held[i]).map((g) => g._id));
  }

  private gates() { return this.graph.nodes.filter((n) => n.type === "gate").map((n) => n._id); }

  // ------------------------------------------------------------------ the controller

  /**
   * Get a vehicle moving towards its gate: work out the routes on offer, request them from the policy gate
   * in order of preference, and act on the answer. Allowed: go. Needs approval: wait for the supervisor.
   * Denied: try the next. Nothing permitted: hold position.
   */
  private async dispatch(id: string, origin: Origin, why?: string): Promise<TaxiOutcome | null> {
    const flight = this.flights.get(id);
    if (!flight) return null;
    let lastDenial: Verdict | undefined;
    let reassigned_from: string | undefined;
    const outcome = (decision: TaxiOutcome["decision"], extra: Partial<TaxiOutcome> = {}): TaxiOutcome =>
      ({ flight: flight.name, decision, gate: flight.gate, gate_name: this.node(flight.gate).name, route: [], ...(reassigned_from ? { reassigned_from } : {}), ...extra });
    for (let attempt = 0; attempt < 2; attempt++) {
      const candidates = await this.candidates(origin, flight.gate, !this.refused.has(id));
      let occupied = false;
      for (const c of candidates) {
        const plan = buildPlan(c.rest, config.stepM, c.first);
        if (!plan.wps.length) { await this.arrive(id); return outcome("arrived"); }
        const { action, verdict } = await this.request(id, flight, plan, c.first?.line);
        const asked = { action_id: action._id, policy_ids: verdict.policy_ids, reason: verdict.reason, route: this.names(plan.legs) };
        if (verdict.decision === "allow") {
          await this.go(id, plan, origin.position);
          if (why) this.record(CONTROLLER, "route.replanned", "vehicles", id, `${flight.name} ${why}: now to ${this.node(flight.gate).name} via ${this.via(plan.legs)} (${action._id})`);
          return outcome("allow", asked);
        }
        if (verdict.decision === "needs_approval") { await this.wait(id, origin); return outcome("needs_approval", asked); }
        lastDenial = verdict;
        if (verdict.rules.includes("gate_occupied")) { occupied = true; break; }
      }
      // The gate is taken: choose another and try once more.
      const was = this.node(flight.gate).name;
      if (!(occupied && attempt === 0 && (await this.reassign(id, flight, origin, lastDenial!)))) break;
      reassigned_from = was;
    }
    await this.hold(id, origin, flight, lastDenial);
    return outcome("deny", {
      policy_ids: lastDenial?.policy_ids,
      reason: lastDenial?.reason ?? (this.refused.has(id) ? "the supervisor refused the runway crossing and there is no other route" : "no route avoids the closures in force"),
    });
  }

  /** Ask the policy gate. The decision is recorded as an action whatever it is. */
  private async request(id: string, flight: Flight, plan: Plan, ahead?: Position[]) {
    const edges = plan.legs.map((l) => l.edge._id);
    const result = await this.gate.decide({ agent_id: CONTROLLER, vehicle_id: id, gate: flight.gate, edges, ahead });
    const { action, verdict } = result;
    this.record(CONTROLLER, "action.decided", "actions", action._id,
      `${action._id} ${flight.name} to ${this.node(flight.gate).name} via ${this.via(plan.legs)}: ${verdict.decision.toUpperCase()} [${verdict.policy_ids.join(", ")}] ${verdict.reason}`);
    return result;
  }

  /** The routes on offer from here, best first: those needing no approval, then the rest, each by length. */
  private async candidates(origin: Origin, gate: NodeId, allowRestricted: boolean): Promise<Candidate[]> {
    const closed = this.closedEdges();
    const starts: { first?: Candidate["first"]; node: NodeId; avoid: Set<EdgeId> }[] = [];
    if ("leg" in origin) {
      // Part-way along an edge: carry on to the end of it or turn back, whichever stretch is clear.
      const { edge, forward } = origin.leg;
      const { before, after } = splitAt(oriented(origin.leg), origin.position);
      const behind = [...before].reverse();
      const [aheadBlocked, behindBlocked] = closed.has(edge._id) ? await Promise.all([this.lineBlocked(after), this.lineBlocked(behind)]) : [false, false];
      const avoid = new Set([...closed, edge._id]);
      if (!aheadBlocked) starts.push({ first: { line: after, step: origin.leg }, node: forward ? edge.to : edge.from, avoid });
      if (!behindBlocked) starts.push({ first: { line: behind, step: { edge, forward: !forward } }, node: forward ? edge.from : edge.to, avoid });
    } else starts.push({ node: origin.node, avoid: closed });

    const out = new Map<string, Candidate>();
    for (const s of starts) for (const restricted of allowRestricted ? [false, true] : [false]) {
      const rest = findRoute(this.graph, s.node, gate, { avoidKinds: restricted ? [] : [...RESTRICTED], avoidEdges: s.avoid });
      if (!rest) continue;
      const first = s.first && s.first.line.length > 1 ? s.first : undefined;
      const legs = [...(first ? [first.step] : []), ...rest];
      const key = legs.map((l) => l.edge._id).join();
      const c: Candidate = {
        first, rest, length: (first ? lengthM(first.line) : 0) + rest.reduce((sum, r) => sum + r.edge.length_m, 0),
        needsApproval: legs.some((l) => (RESTRICTED as readonly string[]).includes(l.edge.kind)),
      };
      if (!out.has(key)) out.set(key, c);
    }
    return [...out.values()].sort((a, b) => Number(a.needsApproval) - Number(b.needsApproval) || a.length - b.length);
  }

  /** Allowed: write the route and start moving. */
  private async go(id: string, plan: Plan, position: Position) {
    this.parked.delete(id);
    this.held.delete(id);
    await this.database.col.vehicles.updateOne({ _id: id }, { $set: { route: plan.legs.map((l) => l.edge._id), status: "moving", heading: plan.wps[0].heading, ts: new Date() } });
    this.sim.follow(id, plan, position);
  }

  private async arrive(id: string) {
    this.sim.drop(id);
    this.parked.delete(id);
    this.held.delete(id);
    await this.database.col.vehicles.updateOne({ _id: id }, { $set: { route: [], status: "idle", ts: new Date() } });
  }

  /** Needs approval: stop where we are until a supervisor answers. */
  private async wait(id: string, origin: Origin) {
    this.sim.drop(id);
    this.parked.set(id, origin);
    this.held.delete(id);
    await this.database.col.vehicles.updateOne({ _id: id }, { $set: { route: [], status: "awaiting_approval", ts: new Date() } });
  }

  /** Nothing permitted: stop and wait for the airport to change. */
  private async hold(id: string, origin: Origin, flight: Flight, denial?: Verdict) {
    this.sim.drop(id);
    this.parked.set(id, origin);
    const already = this.held.has(id);
    this.held.add(id);
    await this.database.col.vehicles.updateOne({ _id: id }, { $set: { route: [], status: "idle", ts: new Date() } });
    if (already) return; // still stuck: already recorded
    const because = denial ? `request denied (${denial.reason})` : this.refused.has(id) ? "the supervisor refused the runway crossing and no other route exists" : "no route avoids the closures in force";
    this.record(CONTROLLER, "route.replanned", "vehicles", id, `${flight.name} holding position short of ${this.node(flight.gate).name}: ${because}`);
  }

  /** The requested gate is taken: pick the free gate with the shortest route from here. */
  private async reassign(id: string, flight: Flight, origin: Origin, denial: Verdict): Promise<boolean> {
    const taken = await this.takenGates(id);
    const options: { gate: NodeId; c: Candidate }[] = [];
    for (const g of this.graph.nodes.filter((n) => n.type === "gate" && !taken.has(n._id))) {
      const [best] = await this.candidates(origin, g._id, !this.refused.has(id));
      if (best) options.push({ gate: g._id, c: best });
    }
    const pick = options.sort((a, b) => Number(a.c.needsApproval) - Number(b.c.needsApproval) || a.c.length - b.c.length)[0];
    if (!pick) return false;
    const was = this.node(flight.gate).name;
    flight.gate = pick.gate;
    await this.database.col.vehicles.updateOne({ _id: id }, { $set: { "details.gate": pick.gate, ts: new Date() } });
    this.record(CONTROLLER, "route.replanned", "vehicles", id, `${flight.name} reassigned from ${was} to ${this.node(pick.gate).name}: ${denial.reason}`);
    return true;
  }

  /** Reroute every moving vehicle whose remaining path touches a closure. */
  private async replanAffected(becauseOf?: string) {
    if (this.halted) return; // nothing is granted while halted; `resume` runs this again
    const closed = this.closedEdges();
    for (const id of this.sim.ids()) {
      const at = this.sim.where(id);
      if (!at) continue;
      const later = at.remaining.some((s) => closed.has(s.edge._id));
      if (!later && !closed.has(at.leg.edge._id)) continue;
      this.sim.pause(id); // hold still while deciding, so the new route starts from where the vehicle really is
      const here = this.sim.where(id)!;
      if (!later && !(await this.lineBlocked(splitAt(oriented(here.leg), here.position).after))) {
        this.sim.unpause(id); // the closure is on this edge but behind the vehicle: nothing to change
        continue;
      }
      await this.dispatch(id, here, `rerouted around ${becauseOf ? `closure ${becauseOf}` : "the closures in force"}`);
    }
  }

  private async retryHeld() {
    if (this.halted) return;
    for (const id of [...this.held]) {
      const origin = this.parked.get(id);
      if (origin) await this.dispatch(id, origin, "resumed after a closure was lifted");
    }
  }

  // ------------------------------------------------------------------ approvals

  /** A supervisor answers a `needs_approval` action. The action is never changed: the answer is a new record. */
  async resolveApproval(actionId: string, req: ResolveApprovalRequest): Promise<Resolution> {
    if (req?.decision !== "approve" && req?.decision !== "deny") throw new HttpError(400, "bad_request", 'decision must be "approve" or "deny"');
    if (req.note !== undefined && typeof req.note !== "string") throw new HttpError(400, "bad_request", "note must be a string");
    return this.exclusive(async () => {
      const { actions, approvals, vehicles } = this.database.col;
      const action = await actions.findOne({ _id: actionId });
      if (!action) throw new HttpError(404, "not_found", `No action ${actionId}`);
      if (action.decision !== "needs_approval") throw new HttpError(409, "not_pending", `${actionId} was decided "${action.decision}" and needs no approval`);
      if (action.run_id !== this.run._id) throw new HttpError(409, "not_pending", `${actionId} belongs to an earlier run`);
      if (this.halted) throw new HttpError(409, "halted", "The run is halted. Resume it before resolving approvals.");

      const resolution: Doc = {
        _id: `RES-${pad(this.nextResolution, 4)}`, run_id: this.run._id, resolves: actionId, decision: req.decision,
        resolved_by: SUPERVISOR, ...(req.note ? { note: req.note } : {}), ts: new Date(),
      };
      try { await approvals.insertOne(resolution); }
      catch (e: any) {
        if (e.code === 11000) throw new HttpError(409, "not_pending", `${actionId} has already been resolved`); // unique index on `resolves`
        throw e;
      }
      this.nextResolution++;

      const id: string = action.payload.vehicle_id;
      const flight = this.flights.get(id);
      const vehicle = await vehicles.findOne({ _id: id });
      this.record(SUPERVISOR, "approval.resolved", "approvals", resolution._id,
        `${SUPERVISOR} ${req.decision === "approve" ? "approved" : "denied"} ${actionId} (${flight?.name ?? id})${req.note ? `: ${req.note}` : ""}`);
      if (!flight || !vehicle) return wire<Resolution>(resolution);

      const at: Position = vehicle.position.coordinates;
      const origin = this.parked.get(id) ?? this.nearest(at);
      if (req.decision === "deny") {
        this.refused.add(id);
        await this.dispatch(id, origin);
        return wire<Resolution>(resolution);
      }
      // Approved. The airport may have changed while it waited, so the gate checks the same route again.
      const steps = orientRoute(this.graph, action.payload.edges, flight.gate);
      const { plan, ahead } = steps ? planFrom(steps, at, config.stepM) : { plan: null, ahead: undefined };
      if (plan?.wps.length && (await this.gate.evaluate({ agent_id: CONTROLLER, vehicle_id: id, gate: flight.gate, edges: action.payload.edges, ahead, approved: true })).decision === "allow") {
        await this.go(id, plan, at);
      } else {
        await this.dispatch(id, origin, "replanned after approval, because the approved route is no longer permitted");
      }
      return wire<Resolution>(resolution);
    });
  }

  // ------------------------------------------------------------------ halt and resume

  /** The kill switch: every vehicle freezes, and the gate denies every request until the run resumes. */
  async halt(reason?: string): Promise<Run> {
    return this.exclusive(async () => {
      if (this.halted) throw new HttpError(409, "halted", "The run is already halted");
      this.sim.halted = true;
      const now = new Date();
      this.run = { ...this.run, status: "halted", halted_by: SUPERVISOR, halted_at: now };
      await this.database.col.runs.updateOne({ _id: this.run._id }, { $set: { status: "halted", halted_by: SUPERVISOR, halted_at: now } });
      await this.database.col.vehicles.updateMany({}, { $set: { status: "halted", ts: now } });
      this.record(SUPERVISOR, "run.halted", "runs", this.run._id, `Run ${this.run._id} halted by ${SUPERVISOR}${reason ? `: ${reason}` : ""}`);
      return this.currentRun();
    });
  }

  async resume(): Promise<Run> {
    return this.exclusive(async () => {
      if (!this.halted) throw new HttpError(409, "not_halted", "The run is not halted");
      const { _id, started_at } = this.run;
      this.run = { _id, status: "running", started_at };
      await this.database.col.runs.updateOne({ _id }, { $set: { status: "running" }, $unset: { halted_by: "", halted_at: "" } });
      // Each vehicle goes back to what it was doing.
      const waiting = new Set((await this.pendingApprovals()).map((a) => a.payload.vehicle_id));
      const now = new Date();
      for (const v of await this.database.col.vehicles.find({}, { projection: { _id: 1 } }).toArray()) {
        const status = this.sim.has(v._id) ? "moving" : waiting.has(v._id) ? "awaiting_approval" : "idle";
        await this.database.col.vehicles.updateOne({ _id: v._id }, { $set: { status, ts: now } });
      }
      this.sim.halted = false;
      this.record(SUPERVISOR, "run.resumed", "runs", _id, `Run ${_id} resumed by ${SUPERVISOR}`);
      // Closures may have come and gone while halted.
      await this.replanAffected();
      await this.retryHeld();
      return this.currentRun();
    });
  }

  // ------------------------------------------------------------------ red team

  /**
   * Ask the gate for a route straight through a closure, as the controller, to show it being refused.
   * The request is real and so is the record; the route is never applied.
   */
  async redteam(): Promise<Action> {
    return this.exclusive(async () => {
      const closed = [...this.zones.values()].flatMap((z) => [...z.edges].map((e) => this.edge(e)));
      const edge = closed.find((e) => !(RESTRICTED as readonly string[]).includes(e.kind)) ?? closed[0];
      if (!edge) throw new HttpError(409, "no_closure", "No closure is blocking a taxiway. Drop a closure first.");
      const id = this.sim.ids()[0] ?? [...this.flights.keys()][0];
      const flight = id ? this.flights.get(id) : undefined;
      const vehicle = id ? await this.database.col.vehicles.findOne({ _id: id }) : null;
      if (!id || !flight || !vehicle) throw new HttpError(409, "no_vehicle", "No vehicle to route. Spawn a flight first.");

      const at = this.sim.where(id);
      const start = at ? (at.leg.forward ? at.leg.edge.to : at.leg.edge.from) : this.nearest(vehicle.position.coordinates).node;
      const through = [true, false].flatMap((forward) => {
        const [a, b] = forward ? [edge.from, edge.to] : [edge.to, edge.from];
        const lead = findRoute(this.graph, start, a, { avoidKinds: [...RESTRICTED], avoidEdges: [edge._id] });
        const tail = findRoute(this.graph, b, flight.gate, { avoidKinds: [...RESTRICTED], avoidEdges: [edge._id] });
        return lead && tail ? [[...lead, { edge, forward }, ...tail]] : [];
      }).sort((x, y) => x.length - y.length)[0] ?? [{ edge, forward: true }];

      const { action, verdict } = await this.gate.decide({ agent_id: CONTROLLER, vehicle_id: id, gate: flight.gate, edges: through.map((s) => s.edge._id) });
      this.record(CONTROLLER, "action.decided", "actions", action._id,
        `${action._id} RED TEAM: ${flight.name} to ${this.node(flight.gate).name} via ${this.via(through)}, through a closure: ${verdict.decision.toUpperCase()} [${verdict.policy_ids.join(", ")}] ${verdict.reason}`);
      return wire<Action>(action);
    });
  }

  // ------------------------------------------------------------------ zones

  async createZone(req: CreateZoneRequest): Promise<Zone> {
    if (req?.type !== "closure") throw new HttpError(400, "bad_request", 'type must be "closure"');
    if (req.geometry?.type !== "Polygon" || !Array.isArray(req.geometry.coordinates)) throw new HttpError(400, "bad_request", "geometry must be a GeoJSON Polygon");
    if (typeof req.ttl_seconds !== "number" || !(req.ttl_seconds > 0) || req.ttl_seconds > MAX_TTL_S) throw new HttpError(400, "bad_request", `ttl_seconds must be a number from 1 to ${MAX_TTL_S}`);
    if (typeof req.reason !== "string" || !req.reason.trim()) throw new HttpError(400, "bad_request", "reason is required");

    return this.exclusive(async () => {
      const doc: Doc = {
        _id: `Z-${pad(this.nextZone, 3)}`, type: "closure", reason: req.reason.trim(),
        geometry: { type: "Polygon", coordinates: req.geometry.coordinates }, created_by: SUPERVISOR,
        expires_at: new Date(Date.now() + req.ttl_seconds * 1000),
      };
      try { await this.database.col.zones.insertOne(doc); }
      catch (e: any) {
        // The 2dsphere index refuses a polygon that is not valid GeoJSON (open ring, self-intersection, bad coordinates).
        if (e.code === 16755 || /geo/i.test(e.message ?? "")) throw new HttpError(400, "bad_request", "geometry is not a valid GeoJSON Polygon");
        throw e;
      }
      this.nextZone++;
      const edges = await this.edgesHit(doc.geometry);
      this.activate(doc, edges);
      const closes = edges.size ? `closes ${[...edges].map((e) => this.edge(e).name).join(", ")}` : "closes no taxiway";
      this.record(SUPERVISOR, "zone.created", "zones", doc._id, `Closure ${doc._id} created for ${req.ttl_seconds} s (${doc.reason}); ${closes}`);
      await this.replanAffected(doc._id);
      return wire<Zone>(doc);
    });
  }

  /** `DELETE /api/zones/:id`: lift a closure early. */
  async removeZone(id: string): Promise<void> {
    if (!this.zones.has(id)) throw new HttpError(404, "not_found", `No active zone ${id}`);
    return this.exclusive(async () => {
      if (!this.zones.has(id)) throw new HttpError(404, "not_found", `No active zone ${id}`);
      this.deactivate(id);
      this.removing.add(id); // so the change stream reports this delete as `zone.removed`
      await this.database.col.zones.deleteOne({ _id: id });
      this.record(SUPERVISOR, "zone.removed", "zones", id, `Closure ${id} removed early by ${SUPERVISOR}`);
      await this.retryHeld();
    });
  }

  /**
   * Called by the change-stream relay when a zone document is deleted. Says which event to send, or
   * null when clients already know (the closure lapsed at `expires_at`, or the scenario was reset).
   */
  zoneDeleted(id: string): "zone.removed" | "zone.expired" | null {
    if (this.removing.delete(id)) return "zone.removed";
    if (!this.zones.has(id)) return null;
    void this.exclusive(() => this.lapse(id, false)); // the TTL monitor got there before our timer
    return "zone.expired";
  }

  /**
   * A closure stops applying at `expires_at`. Mongo's TTL monitor does the delete, but only sweeps about
   * once a minute, so the server announces the expiry on time and the later delete is silent.
   */
  private async lapse(id: string, announce: boolean) {
    const zone = this.zones.get(id);
    if (!zone) return;
    this.deactivate(id);
    if (announce) this.hub.emit("zone.expired", { _id: id });
    this.record(zone.doc.created_by, "zone.expired", "zones", id, `Closure ${id} expired (time limit set by ${zone.doc.created_by})`);
    await this.retryHeld();
  }

  private activate(doc: Doc, edges: Set<EdgeId>) {
    const ms = Math.max(0, doc.expires_at.getTime() - Date.now());
    const timer = setTimeout(() => void this.exclusive(() => this.lapse(doc._id, true)), ms);
    this.zones.set(doc._id, { doc, edges, timer });
  }

  private deactivate(id: string) {
    const zone = this.zones.get(id);
    if (zone) clearTimeout(zone.timer);
    this.zones.delete(id);
  }

  private closedEdges(): Set<EdgeId> {
    return new Set([...this.zones.values()].flatMap((z) => [...z.edges]));
  }

  /** The geospatial check: which taxiway segments does this polygon touch? */
  private async edgesHit(polygon: unknown): Promise<Set<EdgeId>> {
    const hits = await this.database.col.edges.find({ geometry: { $geoIntersects: { $geometry: polygon } } }, { projection: { _id: 1 } }).toArray();
    return new Set(hits.map((e) => e._id));
  }

  /** The same check the other way round: does this stretch of taxiway touch a closure in force? */
  private async lineBlocked(line: Position[]): Promise<boolean> {
    if (line.length < 2 || lengthM(line) < 1) return false;
    const hit = await this.database.col.zones.findOne(
      { _id: { $in: [...this.zones.keys()] }, geometry: { $geoIntersects: { $geometry: { type: "LineString", coordinates: line } } } },
      { projection: { _id: 1 } },
    );
    return hit !== null;
  }

  // ------------------------------------------------------------------ runs

  /** Clear the scenario and open a new run. Earlier runs, their actions and their ledgers are kept, so they stay reviewable. */
  async reset(): Promise<Run> {
    return this.exclusive(async () => {
      await this.sim.clear();
      for (const id of [...this.zones.keys()]) this.deactivate(id); // their deletes are then silent
      this.parked.clear();
      this.held.clear();
      this.refused.clear();
      this.flights.clear();
      await Promise.all([this.database.col.vehicles.deleteMany({}), this.database.col.zones.deleteMany({})]);
      this.nextVehicle = 1;
      this.nextFlight = 101;
      this.run = await this.newRun(num(this.run._id) + 1);
      this.sim.halted = false;
      this.sim.runId = this.run._id;
      await this.ledger.open(this.run._id);
      return this.currentRun();
    });
  }

  private async newRun(n: number): Promise<Doc> {
    const run: Doc = { _id: `R-${n}`, status: "running", started_at: new Date() };
    await this.database.col.runs.insertOne(run); // the insert reaches clients as `sim.reset` via the change stream
    return run;
  }

  // ------------------------------------------------------------------ helpers

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.lock.then(fn);
    this.lock = result.catch((e) => { if (!(e instanceof HttpError)) console.error("operation failed:", e); });
    return result;
  }

  private record(actor: string, event: LedgerEntry["event"], collection: string, id: string, summary: string) {
    this.ledger.append(actor, event, { collection, id }, summary).catch(() => {}); // failures are logged by the ledger
  }

  private node(id: NodeId) { return this.graph.nodes.find((n) => n._id === id)!; }
  private edge(id: EdgeId) { return this.graph.edges.find((e) => e._id === id)!; }
  /** Taxiway names in travel order, without repeating a name for consecutive edges. */
  private names(path: Step[]) { return path.map((s) => s.edge.name).filter((n, i, all) => n !== all[i - 1]); }
  private via(path: Step[]) { return this.names(path).join(", ") || "its current position"; }
  private nearest(position: Position): { node: NodeId; position: Position } {
    const node = this.graph.nodes.reduce((a, b) => (distM(a.location.coordinates, position) <= distM(b.location.coordinates, position) ? a : b));
    return { node: node._id, position };
  }
}
