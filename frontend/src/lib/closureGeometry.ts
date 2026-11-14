import type { GraphEdge, Polygon, Position } from "@contract/types";
import type { Projection } from "./projection";

export const CLOSURE_RADIUS_M = 50;
const CORNERS = 8;

/** A fixed octagon around `centre`, as a closed GeoJSON ring, built in SVG space so it is round on screen. */
export function closureOctagon(centre: Position, projection: Projection): Polygon {
  const [cx, cy] = projection.toSvg(centre);
  const r = CLOSURE_RADIUS_M / projection.metersPerUnit;
  const ring = Array.from({ length: CORNERS }, (_, i) => {
    const a = ((i + 0.5) / CORNERS) * 2 * Math.PI; // corners are 50 m out; the first is half a step round so the sides face the compass
    return projection.toLonLat([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  });
  return { type: "Polygon", coordinates: [[...ring, ring[0]]] };
}

/** "m:ss" until `expiresAt`, rounded up to the next second, never below 0:00. */
export function countdown(expiresAt: string, now: number): string {
  const s = Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function distanceToSegment(p: Position, a: Position, b: Position): number {
  const k = Math.cos((p[1] * Math.PI) / 180);
  const px = p[0] * k, ax = a[0] * k, bx = b[0] * k;
  const dx = bx - ax, dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), p[1] - (a[1] + t * dy));
}

/** Reason text from the edge nearest the click, e.g. "Closure on Taxiway A". */
export function closureReason(click: Position, edges: GraphEdge[]): string {
  let best: GraphEdge | null = null, bestD = Infinity;
  for (const e of edges) {
    const c = e.geometry.coordinates;
    for (let i = 0; i + 1 < c.length; i++) {
      const d = distanceToSegment(click, c[i], c[i + 1]);
      if (d < bestD) { bestD = d; best = e; }
    }
  }
  if (!best) return "Closure";
  return best.kind === "taxiway" && /^[A-Z]\d*$/.test(best.name) ? `Closure on Taxiway ${best.name}` : `Closure on ${best.name}`;
}
