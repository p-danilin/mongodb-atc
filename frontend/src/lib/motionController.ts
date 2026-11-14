import type { Vehicle } from "@contract/types";
import type { Projection } from "./projection";
import { DEFAULT_TICK_MS, retarget, sample, type Track } from "./motion";
import type { Store } from "../state/store";

export const TICK_MS: number = Number(import.meta.env.VITE_TICK_MS ?? DEFAULT_TICK_MS);

/**
 * One requestAnimationFrame loop for all Vehicles. Writes `transform` on each sprite element directly;
 * React is never involved per frame. The loop sleeps when nothing is animating or the page is hidden.
 */
export function createMotionController(store: Store, projection: Projection) {
  const tracks = new Map<string, Track>();
  const seen = new Map<string, Vehicle>();
  const els = new Map<string, SVGGElement>();
  let raf = 0;

  const draw = (id: string, now: number) => {
    const t = tracks.get(id), el = els.get(id);
    if (!t || !el) return false;
    const s = sample(t, now);
    const [x, y] = projection.toSvg(s.position);
    el.setAttribute("transform", `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${s.heading.toFixed(1)})`);
    return s.animating;
  };

  const frame = (now: number) => {
    raf = 0;
    let animating = false;
    for (const id of tracks.keys()) animating = draw(id, now) || animating;
    if (animating && !document.hidden) raf = requestAnimationFrame(frame);
  };
  const wake = () => { if (!raf && !document.hidden) raf = requestAnimationFrame(frame); };

  const sync = () => {
    const vehicles = store.getState().vehicles;
    const now = performance.now();
    for (const id of [...tracks.keys()]) if (!vehicles[id]) { tracks.delete(id); seen.delete(id); }
    for (const v of Object.values(vehicles)) {
      if (seen.get(v._id) === v) continue;
      seen.set(v._id, v);
      tracks.set(v._id, retarget(tracks.get(v._id), { position: v.position.coordinates, heading: v.heading }, now, TICK_MS));
    }
    wake();
  };

  const onVisibility = () => { if (!document.hidden) { for (const id of tracks.keys()) draw(id, performance.now()); wake(); } };
  document.addEventListener("visibilitychange", onVisibility);
  const unsub = store.subscribe(sync);
  sync();

  return {
    /** Ref callback for a Vehicle sprite. */
    attach(id: string, el: SVGGElement | null) {
      if (el) { els.set(id, el); draw(id, performance.now()); } else els.delete(id);
    },
    destroy() {
      unsub(); cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
export type MotionController = ReturnType<typeof createMotionController>;
