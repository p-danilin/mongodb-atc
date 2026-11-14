/** Deterministic route planning and path geometry. Pure functions: no Mongo, no clock. */
import type { EdgeId, EdgeKind, Graph, GraphEdge, NodeId, Position } from "../../docs/contract/types";

export interface Step { edge: GraphEdge; forward: boolean }

export interface PlanOptions {
  /** Edge kinds the route may not use. Level 0 keeps vehicles off the runway and its crossing. */
  avoidKinds?: EdgeKind[];
  /** Specific edges the route may not use (closures, from Level 1). */
  avoidEdges?: Iterable<EdgeId>;
}

/** Shortest path by length (Dijkstra). Returns null when the destination cannot be reached. */
export function findRoute(graph: Graph, from: NodeId, to: NodeId, opts: PlanOptions = {}): Step[] | null {
  const avoidKinds = new Set(opts.avoidKinds ?? []);
  const avoidEdges = new Set(opts.avoidEdges ?? []);
  const dist = new Map<NodeId, number>([[from, 0]]);
  const prev = new Map<NodeId, Step & { node: NodeId }>();
  const todo = new Set([from]);
  while (todo.size) {
    const cur = [...todo].reduce((a, b) => (dist.get(a)! <= dist.get(b)! ? a : b));
    todo.delete(cur);
    if (cur === to) break;
    for (const e of graph.edges) {
      if (avoidKinds.has(e.kind) || avoidEdges.has(e._id)) continue;
      const forward = e.from === cur;
      if (!forward && e.to !== cur) continue;
      const n = forward ? e.to : e.from;
      const d = dist.get(cur)! + e.length_m;
      if (d < (dist.get(n) ?? Infinity)) { dist.set(n, d); prev.set(n, { edge: e, forward, node: cur }); todo.add(n); }
    }
  }
  if (from === to) return [];
  if (!prev.has(to)) return null;
  const path: Step[] = [];
  for (let n = to; n !== from; ) { const p = prev.get(n)!; path.unshift({ edge: p.edge, forward: p.forward }); n = p.node; }
  return path;
}

/**
 * Rebuild travel direction for a stored route (edge ids only), given where it ends.
 * Used to resume vehicles that were mid-taxi when the server restarted.
 */
export function orientRoute(graph: Graph, edgeIds: EdgeId[], endNode: NodeId): Step[] | null {
  const byId = new Map(graph.edges.map((e) => [e._id, e]));
  const steps: Step[] = [];
  let node = endNode;
  for (let i = edgeIds.length - 1; i >= 0; i--) {
    const edge = byId.get(edgeIds[i]);
    if (!edge) return null;
    if (edge.to === node) { steps.unshift({ edge, forward: true }); node = edge.from; }
    else if (edge.from === node) { steps.unshift({ edge, forward: false }); node = edge.to; }
    else return null;
  }
  return steps;
}

const M_PER_DEG_LAT = 111_320;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Compass bearing from a to b: degrees, 0 = north, clockwise. */
export function bearing(a: Position, b: Position): number {
  const dx = (b[0] - a[0]) * Math.cos(rad(a[1])), dy = b[1] - a[1];
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

export const distM = (a: Position, b: Position) =>
  Math.hypot((b[0] - a[0]) * Math.cos(rad(a[1])), b[1] - a[1]) * M_PER_DEG_LAT;

export const lengthM = (coords: Position[]) => coords.slice(1).reduce((sum, c, i) => sum + distM(coords[i], c), 0);

/** The edge's polyline in the direction of travel. */
export const oriented = (step: Step): Position[] =>
  step.forward ? step.edge.geometry.coordinates : [...step.edge.geometry.coordinates].reverse();

const same = (a: Position, b: Position) => a[0] === b[0] && a[1] === b[1];
const dedupe = (coords: Position[]) => coords.filter((c, i) => i === 0 || !same(c, coords[i - 1]));

/** Distance in metres from p to the segment a-b (flat approximation, fine at airport scale). */
function distToSegmentM(p: Position, a: Position, b: Position): number {
  const k = Math.cos(rad(a[1]));
  const [px, py] = [(p[0] - a[0]) * k, p[1] - a[1]], [bx, by] = [(b[0] - a[0]) * k, b[1] - a[1]];
  const len2 = bx * bx + by * by;
  const t = len2 ? Math.min(1, Math.max(0, (px * bx + py * by) / len2)) : 0;
  return Math.hypot(px - bx * t, py - by * t) * M_PER_DEG_LAT;
}

/**
 * Split a polyline at a position on it: `before` runs from the start to the position, `after` from the
 * position to the end. Either may be a single point when the position is at an end.
 */
export function splitAt(coords: Position[], pos: Position): { before: Position[]; after: Position[] } {
  let k = 0;
  for (let i = 1; i < coords.length - 1; i++)
    if (distToSegmentM(pos, coords[i], coords[i + 1]) < distToSegmentM(pos, coords[k], coords[k + 1])) k = i;
  return { before: dedupe([...coords.slice(0, k + 1), pos]), after: dedupe([pos, ...coords.slice(k + 1)]) };
}

/** `leg` is the index into the plan's legs of the edge this waypoint is on. */
export interface Waypoint { position: Position; heading: number; edge: EdgeId; leg: number }

/** Points about every `stepM` metres along one polyline, each with the heading of its segment. */
export function waypointsAlong(coords: Position[], edge: EdgeId, leg: number, stepM: number): Waypoint[] {
  const out: Waypoint[] = [];
  for (let i = 0; i < coords.length - 1; i++) {
    const [a, b] = [coords[i], coords[i + 1]];
    const heading = bearing(a, b);
    const n = Math.max(1, Math.round(distM(a, b) / stepM));
    for (let s = 1; s <= n; s++) {
      const t = s / n;
      out.push({ position: s === n ? b : [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], heading, edge, leg });
    }
  }
  return out;
}

/** What the sim follows: the edges in travel order and the waypoints along them. */
export interface Plan { legs: Step[]; wps: Waypoint[] }

/**
 * Build a plan from whole edges, optionally starting part-way along one (`first`): `first.line` is the
 * stretch of `first.step`'s edge still to travel, starting at the vehicle's position.
 */
export function buildPlan(rest: Step[], stepM: number, first?: { line: Position[]; step: Step }): Plan {
  const legs: Step[] = [];
  const wps: Waypoint[] = [];
  if (first && first.line.length > 1) { wps.push(...waypointsAlong(first.line, first.step.edge._id, 0, stepM)); legs.push(first.step); }
  for (const step of rest) { wps.push(...waypointsAlong(oriented(step), step.edge._id, legs.length, stepM)); legs.push(step); }
  return { legs, wps };
}
