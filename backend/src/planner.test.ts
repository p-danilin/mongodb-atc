import { describe, expect, it } from "vitest";
import seed from "../../docs/contract/seed.json" with { type: "json" };
import type { Graph } from "../../docs/contract/types";
import { bearing, buildPlan, findRoute, lengthM, orientRoute, splitAt } from "./planner";

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

describe("buildPlan", () => {
  it("ends exactly at the destination and heads along each edge", () => {
    const { wps, legs } = buildPlan(findRoute(graph, "RX1", "G1", { avoidKinds: [...noRunway.avoidKinds] })!, 25);
    expect(legs.map((l) => l.edge._id)).toEqual(["E1", "E6"]);
    expect(wps.at(-1)!.position).toEqual([-79.634, 43.67]);
    expect(wps.every((w) => Math.abs(w.heading - 180) < 1e-6)).toBe(true);
    expect(wps.length).toBeGreaterThan(30);
    expect(wps.at(-1)!.leg).toBe(1);
  });

  it("can start part-way along an edge, in either direction", () => {
    const e2 = graph.edges.find((e) => e._id === "E2")!;
    const pos: [number, number] = [-79.633, 43.674];
    const { before, after } = splitAt(e2.geometry.coordinates, pos);
    expect(before).toEqual([[-79.634, 43.674], pos]);
    expect(after).toEqual([pos, [-79.63, 43.674]]);
    const back = buildPlan(findRoute(graph, "J1", "G1")!, 25, { line: [...before].reverse(), step: { edge: e2, forward: false } });
    expect(back.legs.map((l) => l.edge._id)).toEqual(["E2", "E6"]);
    expect(back.wps[0].heading).toBeCloseTo(270);
    expect(back.wps.at(-1)!.position).toEqual([-79.634, 43.67]);
  });

  it("drops a zero-length first stretch", () => {
    const e1 = graph.edges.find((e) => e._id === "E1")!;
    const { before } = splitAt(e1.geometry.coordinates, [-79.634, 43.678]);
    expect(before).toHaveLength(1);
    expect(buildPlan([], 25, { line: before, step: { edge: e1, forward: false } }).legs).toEqual([]);
  });

  it("measures length in metres", () => {
    expect(lengthM([[-79.634, 43.678], [-79.634, 43.674]])).toBeCloseTo(445, -1);
  });

  it("bearing is clockwise from north", () => {
    expect(bearing([0, 0], [0, 1])).toBeCloseTo(0);
    expect(bearing([0, 0], [1, 0])).toBeCloseTo(90);
    expect(bearing([0, 0], [-1, 0])).toBeCloseTo(270);
  });
});
