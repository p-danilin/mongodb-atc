import type { Vehicle } from "@contract/types";
import type { Projection } from "./projection";
import { DEFAULT_TICK_MS, retarget, sample, type Track } from "./motion";
import { fxFrame, flashTarget } from "./vehicleFx";
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
  const labels = new Map<string, SVGGElement>();
  const fx = new Map<string, { ring: SVGElement; flash: SVGElement }>();
  const flashes = new Map<string, number>();
  let raf = 0;

  const draw = (id: string, now: number) => {
    const t = tracks.get(id), el = els.get(id);
    if (!t || !el) return false;
    const s = sample(t, now);
    const [x, y] = projection.toSvg(s.position);
    el.setAttribute("transform", `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${s.heading.toFixed(1)})`);
    labels.get(id)?.setAttribute("transform", `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
    return s.animating;
  };

  /** Amber ring and red flash, written straight to the DOM like the motion. */
  const drawFx = (id: string, now: number) => {
    const el = fx.get(id), v = store.getState().vehicles[id];
    if (!el || !v) return false;
    const f = fxFrame(v.status, flashes.get(id) ?? null, now);
    el.ring.setAttribute("opacity", f.ring.toFixed(3));
    el.flash.setAttribute("opacity", f.flash.toFixed(3));
    if (!f.animating) flashes.delete(id);
    return f.animating;
  };

  const frame = (now: number) => {
    raf = 0;
    let animating = false;
    for (const id of tracks.keys()) animating = draw(id, now) || animating;
    for (const id of fx.keys()) animating = drawFx(id, now) || animating;
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
  // The flash starts from the decision message itself, not from the ledger feed.
  const unsubMessages = store.onMessage((m) => {
    const id = flashTarget(m);
    if (id) { flashes.set(id, performance.now()); wake(); }
  });
  sync();

  return {
    /** Ref callback for a Vehicle sprite. */
    attach(id: string, el: SVGGElement | null) {
      if (el) { els.set(id, el); draw(id, performance.now()); } else els.delete(id);
    },
    /** Ref callback for a Vehicle's callsign label. It follows the position but does not rotate. */
    attachLabel(id: string, el: SVGGElement | null) {
      if (el) { labels.set(id, el); draw(id, performance.now()); } else labels.delete(id);
    },
    /** Ref callback for a Vehicle's amber ring and red flash circles. */
    attachFx(id: string, el: { ring: SVGElement; flash: SVGElement } | null) {
      if (el) { fx.set(id, el); drawFx(id, performance.now()); wake(); } else fx.delete(id);
    },
    destroy() {
      unsub(); unsubMessages(); cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
export type MotionController = ReturnType<typeof createMotionController>;
