import type { Position } from "../../docs/contract/types";
import { config } from "./config";
import type { Database, Doc } from "./db";
import type { Plan, Step } from "./planner";

interface Track extends Plan { i: number; position: Position; paused: boolean }

/** Where a vehicle is on its plan: the edge it is on (or about to enter) and the edges after it. */
export interface Where { position: Position; leg: Step; remaining: Step[] }

/**
 * The simulation tick. Each tick advances every moving vehicle one waypoint and writes the new
 * position to Mongo. It never talks to the websocket: the change stream carries each write to the map.
 */
export class Sim {
  private tracks = new Map<string, Track>();
  private timer: NodeJS.Timeout | null = null;
  private ticking: Promise<void> | null = null;
  /** The kill switch: while true, no vehicle moves. */
  halted = false;
  /** Position writes only apply to vehicles of this run, so a stale writer can never move a later run's vehicle. */
  runId = "";

  constructor(private database: Database) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.ticking) return; // a slow write: skip this tick rather than overlap
      this.ticking = this.tick().catch((e) => console.error("tick failed:", e.message)).finally(() => { this.ticking = null; });
    }, config.tickMs);
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.ticking;
  }

  /** Start moving a vehicle along a plan from `position`, replacing any plan it was on. `i` skips waypoints already passed. */
  follow(vehicleId: string, plan: Plan, position: Position, i = 0) {
    if (i >= plan.wps.length) { this.tracks.delete(vehicleId); return; }
    this.tracks.set(vehicleId, { ...plan, i, position, paused: false });
  }

  ids() { return [...this.tracks.keys()]; }
  has(vehicleId: string) { return this.tracks.has(vehicleId); }

  where(vehicleId: string): Where | null {
    const t = this.tracks.get(vehicleId);
    if (!t) return null;
    const leg = t.wps[t.i].leg;
    return { position: t.position, leg: t.legs[leg], remaining: t.legs.slice(leg + 1) };
  }

  /** Hold a vehicle where it is while its route is being replanned. `follow` or `unpause` releases it. */
  pause(vehicleId: string) { const t = this.tracks.get(vehicleId); if (t) t.paused = true; }
  unpause(vehicleId: string) { const t = this.tracks.get(vehicleId); if (t) t.paused = false; }

  /** Stop tracking a vehicle (it stays where it is). */
  drop(vehicleId: string) { this.tracks.delete(vehicleId); }

  /** Forget every track and wait for an in-flight tick, so no position write lands after this returns. */
  async clear() {
    this.tracks.clear();
    await this.ticking;
  }

  private async tick() {
    const writes: Promise<unknown>[] = [];
    if (this.halted) return;
    for (const [id, t] of this.tracks) {
      if (t.paused) continue;
      const w = t.wps[t.i++];
      t.position = w.position;
      const done = t.i >= t.wps.length;
      if (done) this.tracks.delete(id);
      const set: Partial<Doc> = { position: { type: "Point", coordinates: w.position }, heading: w.heading, ts: new Date() };
      if (done) { set.status = "idle"; set.route = []; }
      writes.push(this.database.col.vehicles.updateOne({ _id: id, run_id: this.runId }, { $set: set }));
    }
    await Promise.all(writes);
  }
}
