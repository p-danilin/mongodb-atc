import type { Position } from "@contract/types";

export interface Pose { position: Position; heading: number }

/** Default ease duration, about one server tick. */
export const DEFAULT_TICK_MS = 500;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const norm = (deg: number) => ((deg % 360) + 360) % 360;
/** Signed shortest rotation from `from` to `to`, in (-180, 180]. */
const shortest = (from: number, to: number) => ((((to - from) % 360) + 540) % 360) - 180;

/** Pose `elapsedMs` after the latest update. Linear, clamped at the target, heading takes the short arc. */
export function ease(prev: Pose, next: Pose, elapsedMs: number, tickMs = DEFAULT_TICK_MS): Pose {
  const t = clamp01(elapsedMs / tickMs);
  if (t >= 1) return next;
  if (t <= 0) return prev;
  return {
    position: [
      prev.position[0] + (next.position[0] - prev.position[0]) * t,
      prev.position[1] + (next.position[1] - prev.position[1]) * t,
    ],
    heading: norm(prev.heading + shortest(prev.heading, next.heading) * t),
  };
}

export interface Track { from: Pose; to: Pose; startedAt: number; tickMs: number }

export function sample(track: Track, now: number): Pose & { animating: boolean } {
  const elapsed = now - track.startedAt;
  return { ...ease(track.from, track.to, elapsed, track.tickMs), animating: elapsed < track.tickMs };
}

/** New update arrived: ease from whatever is currently displayed to the new pose. First sighting does not animate. */
export function retarget(track: Track | undefined, to: Pose, now: number, tickMs = DEFAULT_TICK_MS): Track {
  if (!track) return { from: to, to, startedAt: now, tickMs };
  const { position, heading } = sample(track, now);
  return { from: { position, heading }, to, startedAt: now, tickMs };
}
