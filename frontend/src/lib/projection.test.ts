import { describe, it, expect } from "vitest";
import { makeProjection } from "./projection";
import type { Bounds } from "@contract/types";

const bounds: Bounds = [-79.638, 43.668, -79.618, 43.688];
const p = makeProjection(bounds, { padding: 0 });

describe("projection", () => {
  it("maps bounds corners to viewBox corners with y flipped", () => {
    const [x0, y0] = p.toSvg([-79.638, 43.688]); // NW
    const [x1, y1] = p.toSvg([-79.618, 43.668]); // SE
    expect(x0).toBeCloseTo(0); expect(y0).toBeCloseTo(0);
    expect(x1).toBeCloseTo(p.width); expect(y1).toBeCloseTo(p.height);
  });
  it("north is up", () => {
    expect(p.toSvg([-79.628, 43.685])[1]).toBeLessThan(p.toSvg([-79.628, 43.671])[1]);
  });
  it("scales longitude by cos(lat)", () => {
    const k = Math.cos(((43.668 + 43.688) / 2) * Math.PI / 180);
    expect(p.width / p.height).toBeCloseTo((0.02 * k) / 0.02);
  });
  it("round-trips", () => {
    const pt: [number, number] = [-79.6271, 43.6753];
    const back = p.toLonLat(p.toSvg(pt));
    expect(back[0]).toBeCloseTo(pt[0], 9); expect(back[1]).toBeCloseTo(pt[1], 9);
  });
  it("reports ground metres per SVG unit", () => {
    expect(makeProjection(bounds, { scale: 40000 }).metersPerUnit).toBeCloseTo(111320 / 40000);
  });
  it("padding grows the viewBox and offsets points", () => {
    const q = makeProjection(bounds, { padding: 50 });
    expect(q.toSvg([-79.638, 43.688])).toEqual([50, 50]);
    expect(q.viewBox[2]).toBeCloseTo(q.width + 100);
  });
});
