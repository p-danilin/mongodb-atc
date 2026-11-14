import { describe, it, expect } from "vitest";
import seed from "@contract/seed.json";
import type { Graph } from "@contract/types";
import { makeProjection } from "./projection";
import { closureOctagon, countdown, closureReason, CLOSURE_RADIUS_M } from "./closureGeometry";

const graph = seed.graph as unknown as Graph;
const proj = makeProjection(graph.bounds, { padding: 80 });
const centre: [number, number] = [(graph.bounds[0] + graph.bounds[2]) / 2, (graph.bounds[1] + graph.bounds[3]) / 2];

const metres = (a: [number, number], b: [number, number]) => {
  const k = Math.cos((a[1] * Math.PI) / 180);
  return Math.hypot((b[0] - a[0]) * k * 111_320, (b[1] - a[1]) * 111_320);
};

describe("closure octagon", () => {
  const poly = closureOctagon(centre, proj);
  const ring = poly.coordinates[0];

  it("is a closed ring of eight corners", () => {
    expect(poly.type).toBe("Polygon");
    expect(ring).toHaveLength(9);
    expect(ring[0]).toEqual(ring[8]);
  });

  it("has corners about 50 m from the click", () => {
    expect(CLOSURE_RADIUS_M).toBe(50);
    for (const p of ring) expect(metres(centre, p as [number, number])).toBeGreaterThan(48);
    for (const p of ring) expect(metres(centre, p as [number, number])).toBeLessThan(52);
  });

  it("round-trips through the projection", () => {
    const back = proj.toLonLat(proj.toSvg(ring[2] as [number, number]));
    expect(back[0]).toBeCloseTo(ring[2][0], 9);
    expect(back[1]).toBeCloseTo(ring[2][1], 9);
  });
});

describe("countdown", () => {
  const now = Date.parse("2026-01-01T00:00:00Z");
  it("formats minutes and seconds", () => {
    expect(countdown("2026-01-01T00:00:42Z", now)).toBe("0:42");
    expect(countdown("2026-01-01T00:05:00Z", now)).toBe("5:00");
    expect(countdown("2026-01-01T00:01:05.400Z", now)).toBe("1:06");
  });
  it("never goes negative after expiry", () => {
    expect(countdown("2025-12-31T23:59:00Z", now)).toBe("0:00");
  });
});

describe("closureReason", () => {
  it("names the taxiway closest to the click", () => {
    const e = graph.edges.find((x) => x.kind === "taxiway" && x.name === "A")!;
    const mid = e.geometry.coordinates[Math.floor(e.geometry.coordinates.length / 2)] as [number, number];
    expect(closureReason(mid, graph.edges)).toBe("Closure on Taxiway A");
  });
  it("uses the edge name as is when it is not a lettered taxiway", () => {
    const e = graph.edges.find((x) => x.kind === "runway")!;
    const mid = e.geometry.coordinates[0] as [number, number];
    expect(closureReason(mid, [e])).toBe(`Closure on ${e.name}`);
  });
  it("falls back when there are no edges", () => {
    expect(closureReason(centre, [])).toBe("Closure");
  });
});
