/**
 * Scripted-playback world for the mock server. Disposable: delete the `mock/` folder once Brain's server is live.
 * Follows docs/contract/api.md. To add Level 1/2 (zones, needs_approval, halt), add handlers in `routes` in server.ts
 * and publish through `world.emit`; all state lives in `world.state`.
 */
import seed from "../../docs/contract/seed.json" with { type: "json" };
import type { Graph, GraphEdge, Position, Run, Snapshot, Vehicle, WsMessage } from "../../docs/contract/types";

export const TICK_MS = 500;
export const STEP_M = 25; // metres travelled per tick

export const graph = seed.graph as unknown as Graph;
const edgeById = new Map(graph.edges.map((e) => [e._id, e]));

export interface Waypoint { position: Position; heading: number; edge: string }

/** Shortest path by length over taxiway and apron edges only (Level 0 has no runway use). */
export function findRoute(from: string, to: string): { edge: GraphEdge; forward: boolean }[] | null {
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, { edge: GraphEdge; forward: boolean; node: string }>();
  const todo = new Set([from]);
  while (todo.size) {
    const cur = [...todo].reduce((a, b) => (dist.get(a)! <= dist.get(b)! ? a : b));
    todo.delete(cur);
    if (cur === to) break;
    for (const e of graph.edges) {
      if (e.kind === "runway" || e.kind === "runway_crossing") continue;
      const forward = e.from === cur;
      if (!forward && e.to !== cur) continue;
      const n = forward ? e.to : e.from;
      const d = dist.get(cur)! + e.length_m;
      if (d < (dist.get(n) ?? Infinity)) { dist.set(n, d); prev.set(n, { edge: e, forward, node: cur }); todo.add(n); }
    }
  }
  if (!prev.has(to)) return null;
  const path: { edge: GraphEdge; forward: boolean }[] = [];
  for (let n = to; n !== from; ) { const p = prev.get(n)!; path.unshift({ edge: p.edge, forward: p.forward }); n = p.node; }
  return path;
}

const M_PER_DEG_LAT = 111_320;
function bearing(a: Position, b: Position): number {
  const k = Math.cos((a[1] * Math.PI) / 180);
  const dx = (b[0] - a[0]) * k, dy = b[1] - a[1];
  return (((Math.atan2(dx, dy) * 180) / Math.PI) + 360) % 360;
}
const distM = (a: Position, b: Position) =>
  Math.hypot((b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180), b[1] - a[1]) * M_PER_DEG_LAT;

/** Points every STEP_M along the path, with the heading of the edge being travelled. */
export function waypoints(path: { edge: GraphEdge; forward: boolean }[]): Waypoint[] {
  const out: Waypoint[] = [];
  for (const { edge, forward } of path) {
    const pts = forward ? edge.geometry.coordinates : [...edge.geometry.coordinates].reverse();
    for (let i = 0; i < pts.length - 1; i++) {
      const [a, b] = [pts[i], pts[i + 1]];
      const heading = bearing(a, b);
      const n = Math.max(1, Math.round(distM(a, b) / STEP_M));
      for (let s = 1; s <= n; s++) {
        const t = s / n;
        out.push({ position: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], heading, edge: edge._id });
      }
    }
  }
  return out;
}

export interface Client { send(data: string): void; close(): void }

export class World {
  seq = 0;
  clients = new Set<Client>();
  vehicles = new Map<string, Vehicle>();
  run: Run = { ...(seed.run as Run) };
  skipNext = 0;
  private timer: NodeJS.Timeout | null = null;
  private nextVehicle = 1;
  private nextFlight = 101;

  snapshot(): Snapshot {
    return { seq: this.seq, vehicles: [...this.vehicles.values()], zones: [], pending_approvals: [], run: this.run };
  }

  /** Assign the next seq and broadcast. A pending `skipNext` burns seq numbers to force a gap. */
  emit<T extends WsMessage["type"]>(type: T, data: Extract<WsMessage, { type: T }>["data"]) {
    this.seq += 1 + this.skipNext;
    this.skipNext = 0;
    const msg = { type, seq: this.seq, ts: new Date().toISOString(), data } as WsMessage;
    const text = JSON.stringify(msg);
    for (const c of this.clients) c.send(text);
  }

  forceGap(n = 1) { this.skipNext += n; }
  dropClients() { for (const c of [...this.clients]) c.close(); }

  spawnFlight(gate: string, flight?: string): Vehicle {
    const path = findRoute("RX1", gate);
    if (!path) throw Object.assign(new Error(`No route from RX1 to ${gate} at Level 0`), { status: 400, code: "no_route" });
    this.stopTaxi();
    const id = `V-${this.nextVehicle++}`;
    const wps = waypoints(path);
    const start = graph.nodes.find((n) => n._id === "RX1")!.location.coordinates;
    const route = path.map((p) => p.edge._id);
    const v = this.vehicle(id, flight ?? `AC${this.nextFlight++}`, gate, start, wps[0].heading, route, "moving");
    this.vehicles.set(id, v);
    this.emit("vehicle.spawned", v);
    let i = 0;
    this.timer = setInterval(() => {
      const w = wps[i++];
      const done = i >= wps.length;
      const next = this.vehicle(id, (v.details as { flight: string }).flight, gate, w.position, w.heading, done ? [] : route, done ? "idle" : "moving");
      this.vehicles.set(id, next);
      this.emit("vehicle.moved", next);
      if (done) this.stopTaxi();
    }, TICK_MS);
    return v;
  }

  reset(): Run {
    this.stopTaxi();
    this.vehicles.clear();
    this.run = { ...(seed.run as Run) };
    this.emit("sim.reset", this.run);
    return this.run;
  }

  private stopTaxi() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  private vehicle(id: string, flight: string, gate: string, pos: Position, heading: number, route: string[], status: Vehicle["status"]): Vehicle {
    return {
      _id: id, kind: "aircraft", identity_id: `I-${flight}`, run_id: this.run._id,
      position: { type: "Point", coordinates: pos }, heading, route, status, ts: new Date().toISOString(),
      details: { flight, gate },
    };
  }
}
export { edgeById };
