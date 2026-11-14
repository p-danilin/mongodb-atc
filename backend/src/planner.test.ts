import { describe, expect, it } from "vitest";
import seed from "../../docs/contract/seed.json" with { type: "json" };
import type { Graph } from "../../docs/contract/types";
import { bearing, findRoute, orientRoute, waypoints } from "./planner";

const graph = seed.graph as unknown as Graph;
const ids = (path: ReturnType<typeof findRoute>) => path?.map((s) => s.edge._id);
const noRunway = { avoidKinds: ["runway", "runway_crossing"] as const };

describe("findRoute", () => {
  it("takes the shortest path from the runway exit to a gate", () => {
    expect(ids(findRoute(graph, "RX1", "G1", { avoidKinds: [...noRunway.avoidKinds] }))).toEqual(["E1", "E6"]);
    expect(ids(findRoute(graph, "RX1", "G2", { avoidKinds: [...noRunway.avoidKinds] }))).toEqual(["E1", "E2", "E7"]);
  });

  it("cannot reach the north gates without the runway crossing", () => {
    expect(findRoute(graph, "RX1", "G5", { avoidKinds: [...noRunway.avoidKinds] })).toBeNull();
    expect(ids(findRoute(graph, "RX1", "G5"))).toEqual(["E1", "E2", "E10", "E12"]);
  });

  it("routes around an avoided edge via the apron", () => {
    expect(ids(findRoute(graph, "RX1", "G2", { avoidKinds: [...noRunway.avoidKinds], avoidEdges: ["E2"] }))).toEqual(["E1", "E6", "E15"]);
  });

  it("travels edges backwards when needed", () => {
    const path = findRoute(graph, "G1", "RX1", { avoidKinds: [...noRunway.avoidKinds] })!;
    expect(path.map((s) => s.forward)).toEqual([false, false]);
  });
});

describe("orientRoute", () => {
  it("recovers direction from the edge ids and the end node", () => {
    const path = findRoute(graph, "RX1", "G2", { avoidKinds: [...noRunway.avoidKinds], avoidEdges: ["E2"] })!;
    const again = orientRoute(graph, path.map((s) => s.edge._id), "G2")!;
    expect(again.map((s) => s.forward)).toEqual(path.map((s) => s.forward));
  });

  it("rejects a route that does not connect", () => {
    expect(orientRoute(graph, ["E1", "E9"], "G4")).toBeNull();
  });
});

describe("waypoints", () => {
  it("ends exactly at the destination and heads along each edge", () => {
    const wps = waypoints(findRoute(graph, "RX1", "G1", { avoidKinds: [...noRunway.avoidKinds] })!, 25);
    expect(wps.at(-1)!.position).toEqual([-79.634, 43.67]);
    expect(wps.every((w) => Math.abs(w.heading - 180) < 1e-6)).toBe(true);
    expect(wps.length).toBeGreaterThan(30);
  });

  it("bearing is clockwise from north", () => {
    expect(bearing([0, 0], [0, 1])).toBeCloseTo(0);
    expect(bearing([0, 0], [1, 0])).toBeCloseTo(90);
    expect(bearing([0, 0], [-1, 0])).toBeCloseTo(270);
  });
});
