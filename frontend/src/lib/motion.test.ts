import { describe, it, expect } from "vitest";
import { ease, retarget, sample, type Pose } from "./motion";

const a: Pose = { position: [0, 0], heading: 90 };
const b: Pose = { position: [10, 20], heading: 90 };

describe("motion", () => {
  it("returns the midpoint halfway through the tick", () => {
    expect(ease(a, b, 250, 500).position).toEqual([5, 10]);
  });
  it("clamps at the target once the tick has passed", () => {
    expect(ease(a, b, 5000, 500)).toEqual(b);
    expect(ease(a, b, -10, 500)).toEqual(a);
  });
  it("turns the short way across 0/360 clockwise", () => {
    const h = ease({ ...a, heading: 350 }, { ...b, heading: 10 }, 250, 500).heading;
    expect(h).toBeCloseTo(0);
  });
  it("turns the short way across 0/360 counter-clockwise", () => {
    const h = ease({ ...a, heading: 10 }, { ...b, heading: 350 }, 125, 500).heading;
    expect(h).toBeCloseTo(5);
    expect(ease({ ...a, heading: 10 }, { ...b, heading: 350 }, 500, 500).heading).toBeCloseTo(350);
  });
  it("a stationary vehicle keeps its heading", () => {
    const s = ease(a, { ...a }, 100, 500);
    expect(s.position).toEqual(a.position);
    expect(s.heading).toBe(90);
  });
  it("retarget starts the next ease from the currently displayed pose, not the stale target", () => {
    const t1 = retarget(undefined, b, 0, 500);
    expect(sample(t1, 1000)).toMatchObject(b); // first sighting: no animation from nowhere
    const t2 = retarget(t1, { position: [20, 20], heading: 90 }, 2000, 500);
    expect(sample(t2, 2000).position).toEqual([10, 20]);
    const mid = sample(t2, 2250).position;
    expect(mid).toEqual([15, 20]);
    const t3 = retarget(t2, { position: [30, 20], heading: 90 }, 2250, 500);
    expect(sample(t3, 2250).position).toEqual([15, 20]);
    expect(sample(t3, 2750).position).toEqual([30, 20]);
  });
  it("track reports whether it still needs animating", () => {
    const t = retarget(retarget(undefined, a, 0, 500), b, 1000, 500);
    expect(sample(t, 1100).animating).toBe(true);
    expect(sample(t, 1500).animating).toBe(false);
  });
});
