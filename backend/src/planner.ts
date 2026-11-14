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

export interface Waypoint { position: Position; heading: number; edge: EdgeId }

/** Points about every `stepM` metres along the path, each with the heading of the segment being travelled. */
export function waypoints(path: Step[], stepM: number): Waypoint[] {
  const out: Waypoint[] = [];
  for (const { edge, forward } of path) {
    const pts = forward ? edge.geometry.coordinates : [...edge.geometry.coordinates].reverse();
    for (let i = 0; i < pts.length - 1; i++) {
      const [a, b] = [pts[i], pts[i + 1]];
      const heading = bearing(a, b);
      const n = Math.max(1, Math.round(distM(a, b) / stepM));
      for (let s = 1; s <= n; s++) {
        const t = s / n;
        out.push({ position: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], heading, edge: edge._id });
      }
    }
  }
  return out;
}
