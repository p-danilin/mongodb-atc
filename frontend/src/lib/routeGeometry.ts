import type { EdgeId, GraphEdge, Position } from "@contract/types";

/**
 * Each edge's coordinates for a route, flipped where needed so they run in the direction of travel.
 * A route is a list of edge ids; direction is inferred from how neighbouring edges join.
 * Unknown edge ids are skipped.
 */
export function orientedRoute(edgeIds: EdgeId[], edgeById: Map<EdgeId, GraphEdge>): { id: EdgeId; coords: Position[] }[] {
  return edgeIds.flatMap((id, i) => {
    const e = edgeById.get(id);
    if (!e) return [];
    const next = edgeById.get(edgeIds[i + 1]);
    const prev = edgeById.get(edgeIds[i - 1]);
    const forward = next ? e.to === next.from || e.to === next.to : prev ? e.from === prev.from || e.from === prev.to : true;
    return [{ id, coords: forward ? e.geometry.coordinates : [...e.geometry.coordinates].reverse() }];
  });
}
