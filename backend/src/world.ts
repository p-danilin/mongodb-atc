import seed from "../../docs/contract/seed.json" with { type: "json" };
import type { Bounds, Graph, NodeId, Run, Snapshot, Vehicle } from "../../docs/contract/types";
import { wire, type Database, type Doc } from "./db";
import type { Hub } from "./hub";
import { bearing, findRoute } from "./planner";
import type { Sim } from "./sim";

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

/** Scenario operations behind the API. Everything it changes, it changes by writing to Mongo. */
export class World {
  private run!: Doc;
  private nextVehicle = 1;
  private nextFlight = 101;

  constructor(private database: Database, private hub: Hub, private sim: Sim, readonly graph: Graph) {}

  /** Load the current run (the newest), or create the first one. */
  async init() {
    const { runs, vehicles } = this.database.col;
    const latest = await runs.find().sort({ started_at: -1 }).limit(1).next();
    this.run = latest ?? (await this.newRun(1));
    const existing = await vehicles.find({}, { projection: { "details.flight": 1 } }).toArray();
    for (const v of existing) {
      this.nextVehicle = Math.max(this.nextVehicle, num(v._id) + 1);
      this.nextFlight = Math.max(this.nextFlight, (Number(String(v.details?.flight ?? "").replace(/\D/g, "")) || 100) + 1);
    }
  }

  currentRun(): Run { return wire<Run>(this.run); }

  /** `seq` is read before Mongo, so the snapshot is never older than the seq it claims. */
  async snapshot(): Promise<Snapshot> {
    const seq = this.hub.seq;
    const [vehicles, zones] = await Promise.all([
      this.database.col.vehicles.find().sort({ _id: 1 }).toArray(),
      this.database.col.zones.find().sort({ _id: 1 }).toArray(),
    ]);
    return { seq, vehicles: wire(vehicles), zones: wire(zones), pending_approvals: [], run: this.currentRun() };
  }

  /**
   * Level 0: an arriving flight appears at Runway exit 1 and taxis straight to its gate.
   * From Level 2 this becomes an event for the controller agent, and the route goes through the policy gate.
   */
  async spawnFlight(gate: NodeId, flight?: string): Promise<Vehicle> {
    const from = "RX1";
    if (!this.graph.nodes.some((n) => n._id === gate && n.type === "gate")) throw new HttpError(400, "bad_request", "gate must be a gate node id");
    const path = findRoute(this.graph, from, gate, { avoidKinds: ["runway", "runway_crossing"] });
    if (!path?.length) throw new HttpError(400, "no_route", `No route from ${from} to ${gate} without using the runway`);

    const id = `V-${this.nextVehicle++}`;
    const name = flight ?? `AC${this.nextFlight++}`;
    const identity = `I-${name}`;
    await this.database.col.identities.updateOne(
      { _id: identity },
      { $set: { kind: "vehicle", name, clearances: ["taxiway", "apron"], active: true } },
      { upsert: true },
    );
    const first = path[0];
    const start = this.graph.nodes.find((n) => n._id === from)!.location;
    const coords = first.edge.geometry.coordinates;
    const [a, b] = first.forward ? [coords[0], coords[1]] : [coords[coords.length - 1], coords[coords.length - 2]];
    const doc: Doc = {
      _id: id, kind: "aircraft", identity_id: identity, run_id: this.run._id,
      position: start, heading: bearing(a, b), route: path.map((p) => p.edge._id),
      status: "moving", ts: new Date(), details: { flight: name, gate },
    };
    await this.database.col.vehicles.insertOne(doc);
    this.sim.follow(id, path);
    return wire<Vehicle>(doc);
  }

  /** Clear the scenario and open a new run. Earlier runs are kept, so their records stay reviewable. */
  async reset(): Promise<Run> {
    await this.sim.clear();
    await this.database.col.vehicles.deleteMany({});
    this.nextVehicle = 1;
    this.nextFlight = 101;
    this.run = await this.newRun(num(this.run._id) + 1);
    return this.currentRun();
  }

  private async newRun(n: number): Promise<Doc> {
    const run: Doc = { _id: `R-${n}`, status: "running", started_at: new Date() };
    await this.database.col.runs.insertOne(run); // the insert reaches clients as `sim.reset` via the change stream
    return run;
  }
}
