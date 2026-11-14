import { describe, it, expect } from "vitest";
import type { GraphEdge } from "@contract/types";
import { orientedRoute } from "./routeGeometry";

const edge = (_id: string, from: string, to: string, coordinates: [number, number][]) =>
  ({ _id, from, to, kind: "taxiway", name: _id, length_m: 1, geometry: { type: "LineString", coordinates } }) as GraphEdge;
const E1 = edge("E1", "A", "B", [[0, 0], [1, 0]]);
const E2 = edge("E2", "B", "C", [[1, 0], [1, 1]]);
const E3 = edge("E3", "D", "C", [[2, 1], [1, 1]]); // stored against the direction of travel in a route A→B→C→D
const E4 = edge("E4", "C", "D", [[1, 1], [2, 1]]);
const map = new Map([E1, E2, E3, E4].map((e) => [e._id, e]));

describe("orientedRoute", () => {
  it("keeps edges that already run in the direction of travel", () => {
    expect(orientedRoute(["E1", "E2"], map).map((r) => r.coords)).toEqual([[[0, 0], [1, 0]], [[1, 0], [1, 1]]]);
  });
  it("flips an edge stored against the direction of travel", () => {
    const r = orientedRoute(["E2", "E3"], map);
    expect(r[1].coords).toEqual([[1, 1], [2, 1]]);
  });
  it("uses the previous edge for the last edge", () => {
    expect(orientedRoute(["E2", "E3"], map)[1].coords[0]).toEqual([1, 1]);
  });
  it("leaves a single edge as stored", () => {
    expect(orientedRoute(["E3"], map)[0].coords).toEqual([[2, 1], [1, 1]]);
  });
  it("skips unknown edge ids", () => {
    expect(orientedRoute(["E1", "X9"], map).map((r) => r.id)).toEqual(["E1"]);
  });
});
