import { describe, expect, it } from "vitest";
import seed from "../../docs/contract/seed.json" with { type: "json" };
import type { Graph } from "../../docs/contract/types";
import { bearing, buildPlan, findRoute, lengthM, orientRoute, splitAt } from "./planner";

const graph = seed.graph as unknown as Graph;
const ids = (path: ReturnType<typeof findRoute>) => path?.map((s) => s.edge._id);
const noRunway = { avoidKinds: ["runway", "runway_crossing"] as const };

describe("findRoute", () => {
  it("takes the shortest path from the runway exit to a gate", () => {
    expect(ids(findRoute(graph, "RX1", "G1", { avoidKinds: [...noRunway.avoidKinds] }))).toEqual(["E4", "E5", "E14", "E21"]);
    expect(ids(findRoute(graph, "RH1", "G2", { avoidKinds: [...noRunway.avoidKinds] }))).toEqual(["E12", "E15", "E22"]);
  });

  it("cannot reach the north gates without the runway crossing", () => {
    expect(findRoute(graph, "RX1", "G5", { avoidKinds: [...noRunway.avoidKinds] })).toBeNull();
    expect(ids(findRoute(graph, "RH1", "G5"))).toEqual(["E12", "E7", "E25", "E26", "E28"]);
  });

  it("gates are not linked to each other", () => {
    const gates = new Set(graph.nodes.filter((n) => n.type === "gate").map((n) => n._id));
    expect(graph.edges.filter((e) => gates.has(e.from) && gates.has(e.to))).toEqual([]);
  });

  it("leaves the runway by a high-speed exit onto the parallel taxiway", () => {
    const first = findRoute(graph, "RH1", "P3", { avoidKinds: [...noRunway.avoidKinds] })!;
    expect(first.map((s) => s.edge.name)).toEqual(["H1"]);
  });

  it("routes around avoided edges via the taxilane", () => {
    expect(ids(findRoute(graph, "RH1", "G2", { avoidKinds: [...noRunway.avoidKinds], avoidEdges: ["E6", "E15"] }))).toEqual(["E12", "E7", "E8", "E16", "E19", "E22"]);
  });

  it("travels edges backwards when needed", () => {
    const path = findRoute(graph, "G1", "RX1", { avoidKinds: [...noRunway.avoidKinds] })!;
    expect(path.map((s) => s.forward)).toEqual([false, false, false, false]);
  });
});

describe("orientRoute", () => {
  it("recovers direction from the edge ids and the end node", () => {
    const path = findRoute(graph, "RH1", "G2", { avoidKinds: [...noRunway.avoidKinds], avoidEdges: ["E6", "E15"] })!;
    const again = orientRoute(graph, path.map((s) => s.edge._id), "G2")!;
    expect(again.map((s) => s.forward)).toEqual(path.map((s) => s.forward));
  });

  it("rejects a route that does not connect", () => {
    expect(orientRoute(graph, ["E4", "E24"], "G4")).toBeNull();
  });
});

describe("buildPlan", () => {
  it("ends exactly at the destination and heads along each edge", () => {
    const { wps, legs } = buildPlan(findRoute(graph, "RX1", "G1", { avoidKinds: [...noRunway.avoidKinds] })!, 25);
    expect(legs.map((l) => l.edge._id)).toEqual(["E4", "E5", "E14", "E21"]);
    expect(wps.at(-1)!.position).toEqual([-79.634, 43.67]);
    expect(wps[0].heading).toBeCloseTo(180);
    expect(wps.find((w) => w.edge === "E5")!.heading).toBeCloseTo(90);
    expect(wps.at(-1)!.heading).toBeCloseTo(180);
    expect(wps.length).toBeGreaterThan(30);
    expect(wps.at(-1)!.leg).toBe(3);
  });

  it("can start part-way along an edge, in either direction", () => {
    const e6 = graph.edges.find((e) => e._id === "E6")!;
    const pos: [number, number] = [-79.633, 43.6762];
    const { before, after } = splitAt(e6.geometry.coordinates, pos);
    expect(before).toEqual([[-79.634, 43.6762], pos]);
    expect(after).toEqual([pos, [-79.63, 43.6762]]);
    const back = buildPlan(findRoute(graph, "P2", "G1")!, 25, { line: [...before].reverse(), step: { edge: e6, forward: false } });
    expect(back.legs.map((l) => l.edge._id)).toEqual(["E6", "E14", "E21"]);
    expect(back.wps[0].heading).toBeCloseTo(270);
    expect(back.wps.at(-1)!.position).toEqual([-79.634, 43.67]);
  });

  it("drops a zero-length first stretch", () => {
    const e1 = graph.edges.find((e) => e._id === "E4")!;
    const { before } = splitAt(e1.geometry.coordinates, [-79.636, 43.678]);
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
