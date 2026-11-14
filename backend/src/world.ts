import seed from "../../docs/contract/seed.json" with { type: "json" };
import type { Bounds, CreateZoneRequest, EdgeId, Graph, LedgerEntry, NodeId, Position, Run, Snapshot, Vehicle, Zone } from "../../docs/contract/types";
import { config } from "./config";
import { wire, type Database, type Doc } from "./db";
import type { Hub } from "./hub";
import type { Ledger } from "./ledger";
import { buildPlan, distM, findRoute, lengthM, orientRoute, oriented, splitAt, type Plan, type Step } from "./planner";
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
const SUPERVISOR = "supervisor-1"; // there is no auth: the server acts as the supervisor for every human action
const CONTROLLER = "controller-1";
const NO_RUNWAY = ["runway", "runway_crossing"] as const; // until the approval flow exists (Level 2)
const MAX_TTL_S = 3600;

interface ActiveZone { doc: Doc; edges: Set<EdgeId>; timer: NodeJS.Timeout }
interface Flight { name: string; gate: NodeId }

/** Scenario operations behind the API. Everything it changes, it changes by writing to Mongo. */
export class World {
  private run!: Doc;
  private nextVehicle = 1;
  private nextFlight = 101;
  private nextZone = 1;
  /** Closures in force: not yet expired, not removed. */
  private zones = new Map<string, ActiveZone>();
  private removing = new Set<string>();
  private flights = new Map<string, Flight>();
  /** Vehicles stopped because no route avoids the closures. Retried whenever a closure goes away. */
  private held = new Map<string, Where>();
  /** Zone changes and the replans they cause run one at a time. */
  private lock: Promise<unknown> = Promise.resolve();

  constructor(private database: Database, private hub: Hub, private sim: Sim, private ledger: Ledger, readonly graph: Graph) {}

  // ------------------------------------------------------------------ startup

  /** Load the current run (the newest) or create the first one, then pick up what Mongo says is in progress. */
  async init() {
    const { runs, vehicles, zones, ledger } = this.database.col;
    const latest = await runs.find().sort({ started_at: -1 }).limit(1).next();
    this.run = latest ?? (await this.newRun(1));
    await this.ledger.open(this.run._id);

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
      // A vehicle that was mid-taxi when the server stopped carries on from where Mongo says it is.
      const steps = v.status === "moving" && v.route.length ? orientRoute(this.graph, v.route, v.details.gate) : null;
      if (!steps) continue;
      const plan = buildPlan(steps, config.stepM);
      const at: Position = v.position.coordinates;
      let i = 0;
      for (let k = 1; k < plan.wps.length; k++) if (distM(plan.wps[k].position, at) < distM(plan.wps[i].position, at)) i = k;
      this.sim.follow(v._id, plan, at, i + 1);
      resumed++;
    }
    if (this.zones.size) await this.replanAffected();
    return { resumed, zones: this.zones.size };
  }

  // ------------------------------------------------------------------ reads

  currentRun(): Run { return wire<Run>(this.run); }

  /** `seq` is read before Mongo, so the snapshot is never older than the seq it claims. */
  async snapshot(): Promise<Snapshot> {
    const seq = this.hub.seq;
    const vehicles = await this.database.col.vehicles.find().sort({ _id: 1 }).toArray();
    const zones = [...this.zones.values()].map((z) => z.doc);
    return { seq, vehicles: wire(vehicles), zones: wire(zones), pending_approvals: [], run: this.currentRun() };
  }

  async ledgerFor(runId?: string): Promise<LedgerEntry[]> {
    return wire(await this.database.col.ledger.find({ run_id: runId || this.run._id }).sort({ n: 1 }).toArray());
  }

  // ------------------------------------------------------------------ flights

  /**
   * An arriving flight appears at Runway exit 1 and taxis to its gate, avoiding closures.
   * From Level 2 this becomes an event for the controller agent, and the route goes through the policy gate.
   */
  async spawnFlight(gate: NodeId, flight?: string): Promise<Vehicle> {
    const from = this.node("RX1");
    const to = this.graph.nodes.find((n) => n._id === gate && n.type === "gate");
    if (!to) throw new HttpError(400, "bad_request", "gate must be a gate node id");
    const path = findRoute(this.graph, from._id, gate, { avoidKinds: [...NO_RUNWAY], avoidEdges: this.closedEdges() });
    if (!path?.length) throw new HttpError(409, "no_route", `No route from ${from.name} to ${to.name} that avoids the runway and active closures`);

    const id = `V-${this.nextVehicle++}`;
    const name = flight ?? `AC${this.nextFlight++}`;
    const identity = `I-${name}`;
    await this.database.col.identities.updateOne(
      { _id: identity },
      { $set: { kind: "vehicle", name, clearances: ["taxiway", "apron"], active: true } },
      { upsert: true },
    );
    const plan = buildPlan(path, config.stepM);
    const doc: Doc = {
      _id: id, kind: "aircraft", identity_id: identity, run_id: this.run._id,
      position: from.location, heading: plan.wps[0].heading, route: path.map((p) => p.edge._id),
      status: "moving", ts: new Date(), details: { flight: name, gate },
    };
    await this.database.col.vehicles.insertOne(doc);
    this.flights.set(id, { name, gate });
    this.sim.follow(id, plan, from.location.coordinates);
    this.record(SUPERVISOR, "vehicle.spawned", "vehicles", id, `${name} arrived at ${from.name}; taxiing to ${to.name} via ${this.via(path)}`);
    return wire<Vehicle>(doc);
  }

  // ------------------------------------------------------------------ zones

  async createZone(req: CreateZoneRequest): Promise<Zone> {
    if (req?.type !== "closure") throw new HttpError(400, "bad_request", 'type must be "closure"');
    if (req.geometry?.type !== "Polygon" || !Array.isArray(req.geometry.coordinates)) throw new HttpError(400, "bad_request", "geometry must be a GeoJSON Polygon");
    if (typeof req.ttl_seconds !== "number" || !(req.ttl_seconds > 0) || req.ttl_seconds > MAX_TTL_S) throw new HttpError(400, "bad_request", `ttl_seconds must be a number from 1 to ${MAX_TTL_S}`);
    if (typeof req.reason !== "string" || !req.reason.trim()) throw new HttpError(400, "bad_request", "reason is required");

    return this.exclusive(async () => {
      const doc: Doc = {
        _id: `Z-${String(this.nextZone).padStart(3, "0")}`, type: "closure", reason: req.reason.trim(),
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
      const zone = this.zones.get(id);
      if (!zone) throw new HttpError(404, "not_found", `No active zone ${id}`);
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

  // ------------------------------------------------------------------ replanning

  /** Reroute every moving vehicle whose remaining path touches a closure. */
  private async replanAffected(becauseOf?: string) {
    const closed = this.closedEdges();
    for (const id of this.sim.ids()) {
      const at = this.sim.where(id);
      if (!at) continue;
      if (!closed.has(at.leg.edge._id) && !at.remaining.some((s) => closed.has(s.edge._id))) continue;
      this.sim.pause(id); // hold still while we plan, so the new route starts from where the vehicle really is
      await this.reroute(id, this.sim.where(id)!, closed, becauseOf);
    }
  }

  private async retryHeld() {
    const closed = this.closedEdges();
    for (const [id, at] of [...this.held]) await this.reroute(id, at, closed);
  }

  /**
   * Plan from a position part-way along an edge. The vehicle may carry on to the end of its edge or turn
   * back to the start of it, whichever stretch is clear and gives the shorter route. No clear route: hold.
   */
  private async reroute(id: string, at: Where, closed: Set<EdgeId>, becauseOf?: string) {
    const flight = this.flights.get(id);
    if (!flight) { this.sim.unpause(id); return; }
    const { edge, forward } = at.leg;
    const { before, after } = splitAt(oriented(at.leg), at.position);
    const behind = [...before].reverse();
    const onClosed = closed.has(edge._id);
    const [aheadBlocked, behindBlocked] = onClosed ? await Promise.all([this.lineBlocked(after), this.lineBlocked(behind)]) : [false, false];

    if (!aheadBlocked && !this.held.has(id) && !at.remaining.some((s) => closed.has(s.edge._id))) {
      this.sim.unpause(id); // the closure is on this edge but behind the vehicle: nothing to change
      return;
    }

    const avoid = { avoidKinds: [...NO_RUNWAY], avoidEdges: new Set([...closed, edge._id]) };
    const options: { first: { line: Position[]; step: Step }; rest: Step[]; length: number }[] = [];
    const consider = (line: Position[], step: Step, from: NodeId) => {
      const rest = findRoute(this.graph, from, flight.gate, avoid);
      if (rest) options.push({ first: { line, step }, rest, length: lengthM(line) + rest.reduce((sum, s) => sum + s.edge.length_m, 0) });
    };
    if (!aheadBlocked) consider(after, at.leg, forward ? edge.to : edge.from);
    if (!behindBlocked) consider(behind, { edge, forward: !forward }, forward ? edge.from : edge.to);
    const best = options.sort((a, b) => a.length - b.length)[0];
    const gateName = this.node(flight.gate).name;
    const why = becauseOf ? `closure ${becauseOf}` : "the closures in force";

    if (!best) {
      this.sim.drop(id);
      if (this.held.has(id)) return; // still stuck: already recorded
      this.held.set(id, at);
      await this.database.col.vehicles.updateOne({ _id: id }, { $set: { status: "idle", route: [], ts: new Date() } });
      this.record(CONTROLLER, "route.replanned", "vehicles", id, `${flight.name} holding position: no route to ${gateName} avoids ${why}`);
      return;
    }

    const plan: Plan = buildPlan(best.rest, config.stepM, best.first);
    const wasHeld = this.held.delete(id);
    const fields: Record<string, unknown> = plan.wps.length
      ? { route: plan.legs.map((l) => l.edge._id), status: "moving", heading: plan.wps[0].heading, ts: new Date() }
      : { route: [], status: "idle", ts: new Date() };
    await this.database.col.vehicles.updateOne({ _id: id }, { $set: fields });
    this.sim.follow(id, plan, at.position);
    this.record(CONTROLLER, "route.replanned", "vehicles", id,
      wasHeld ? `${flight.name} resumed to ${gateName} via ${this.via(plan.legs)}: a closure was lifted`
              : `${flight.name} rerouted to ${gateName} via ${this.via(plan.legs)} to avoid ${why}`);
  }

  // ------------------------------------------------------------------ runs

  /** Clear the scenario and open a new run. Earlier runs and their ledgers are kept, so they stay reviewable. */
  async reset(): Promise<Run> {
    return this.exclusive(async () => {
      await this.sim.clear();
      for (const id of [...this.zones.keys()]) this.deactivate(id); // their deletes are then silent
      this.held.clear();
      this.flights.clear();
      await Promise.all([this.database.col.vehicles.deleteMany({}), this.database.col.zones.deleteMany({})]);
      this.nextVehicle = 1;
      this.nextFlight = 101;
      this.run = await this.newRun(num(this.run._id) + 1);
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
    this.lock = result.catch((e) => { if (!(e instanceof HttpError)) console.error("zone operation failed:", e); });
    return result;
  }

  private record(actor: string, event: LedgerEntry["event"], collection: string, id: string, summary: string) {
    this.ledger.append(actor, event, { collection, id }, summary).catch(() => {}); // failures are logged by the ledger
  }

  private node(id: NodeId) { return this.graph.nodes.find((n) => n._id === id)!; }
  private edge(id: EdgeId) { return this.graph.edges.find((e) => e._id === id)!; }
  private via(path: Step[]) { return path.map((s) => s.edge.name).join(", ") || "its current position"; }
}
