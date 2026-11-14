import type { Graph, NodeId } from "../../docs/contract/types";
import { config } from "./config";
import type { Database, Doc } from "./db";
import { distM, orientRoute, waypoints, type Step, type Waypoint } from "./planner";

interface Track { wps: Waypoint[]; i: number }

/**
 * The simulation tick. Each tick advances every moving vehicle one waypoint and writes the new
 * position to Mongo. It never talks to the websocket: the change stream carries each write to the map.
 */
export class Sim {
  private tracks = new Map<string, Track>();
  private timer: NodeJS.Timeout | null = null;
  private ticking: Promise<void> | null = null;

  constructor(private database: Database, private graph: Graph) {}

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

  /** Start moving a vehicle along a path. Replaces any path it was on. */
  follow(vehicleId: string, path: Step[]) {
    this.tracks.set(vehicleId, { wps: waypoints(path, config.stepM), i: 0 });
  }

  /** Forget every track and wait for an in-flight tick, so no position write lands after this returns. */
  async clear() {
    this.tracks.clear();
    await this.ticking;
  }

  /** After a restart, pick up vehicles that were mid-taxi from where Mongo says they are. */
  async resume() {
    const moving = await this.database.col.vehicles.find({ status: "moving", "route.0": { $exists: true } }).toArray();
    for (const v of moving) {
      const end: NodeId | undefined = v.details?.gate;
      const path = end ? orientRoute(this.graph, v.route, end) : null;
      if (!path) continue;
      const wps = waypoints(path, config.stepM);
      let i = 0;
      for (let k = 1; k < wps.length; k++) if (distM(wps[k].position, v.position.coordinates) < distM(wps[i].position, v.position.coordinates)) i = k;
      this.tracks.set(v._id, { wps, i: i + 1 });
    }
    return moving.length;
  }

  private async tick() {
    const writes: Promise<unknown>[] = [];
    for (const [id, t] of this.tracks) {
      const w = t.wps[t.i++];
      const done = t.i >= t.wps.length;
      if (done) this.tracks.delete(id);
      if (!w) continue;
      const set: Partial<Doc> = { position: { type: "Point", coordinates: w.position }, heading: w.heading, ts: new Date() };
      if (done) { set.status = "idle"; set.route = []; }
      writes.push(this.database.col.vehicles.updateOne({ _id: id }, { $set: set }));
    }
    await Promise.all(writes);
  }
}
