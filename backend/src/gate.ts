import type { Decision, EdgeId, Graph, GraphEdge, IdentityId, NodeId, Position, VehicleId } from "../../docs/contract/types";
import type { Database, Doc } from "./db";
import { orientRoute } from "./planner";

/** A proposed action: this identity wants to send this vehicle along these edges to its gate. */
export interface RouteRequest {
  agent_id: IdentityId;
  vehicle_id: VehicleId;
  gate: NodeId;
  edges: EdgeId[];
  /** When the vehicle is part-way along the first edge: the stretch of it still to travel. */
  ahead?: Position[];
  /** A supervisor has approved this request, so rules whose effect is `needs_approval` are satisfied. */
  approved?: boolean;
}

export interface Verdict {
  decision: Decision;
  policy_ids: string[];
  reason: string;
  /** The rules behind the decision, so the caller can react (for example, pick another gate). */
  rules: string[];
}

interface Context {
  req: RouteRequest;
  agent: Doc | null;
  edges: GraphEdge[];
}

/**
 * Mongo filter for vehicles that hold a gate: cleared to it (taxiing or waiting on an approval) or parked on it.
 * A flight that is merely bound for a gate and has not been cleared yet does not hold it.
 */
export const holdsGate = (gate: { _id: NodeId; location: { coordinates: Position } }) => ({
  "details.gate": gate._id,
  $or: [{ status: { $in: ["moving", "awaiting_approval"] } }, { "position.coordinates": gate.location.coordinates }],
});

/** What the gate needs to know about the world right now. */
export interface GateState {
  run(): Doc;
  /** Ids of the closures in force. */
  activeZones(): string[];
}

/**
 * The policy gate. Every route request is decided here *before* anything moves, and the decision is
 * stored as an `actions` document: who asked, what for, the decision, which policies applied and why.
 *
 * The rules live in the `policies` collection and are read on every decision. Each policy names a rule
 * implemented below and the effect it has when the rule is broken.
 */
export class Gate {
  private next = 1;

  constructor(private database: Database, private graph: Graph, private state: GateState) {}

  /** Action ids stay unique across runs. */
  async init() {
    const last = await this.database.col.actions.find({}, { projection: { _id: 1 } }).sort({ _id: -1 }).limit(1).next();
    this.next = (Number(last?._id.split("-")[1]) || 0) + 1;
  }

  /** Each rule returns why the request breaks it, or null when it does not. */
  private rules: Record<string, (c: Context, policy: Doc) => Promise<string | null> | string | null> = {
    identity: ({ req, agent }) =>
      agent && agent.active && agent.kind === "agent" ? null : `${req.agent_id} is not an active agent identity`,

    run_halted: () => {
      const run = this.state.run();
      return run.status === "halted" ? `run ${run._id} is halted by ${run.halted_by}` : null;
    },

    connected: ({ req, edges }) => {
      const gate = this.graph.nodes.find((n) => n._id === req.gate);
      if (edges.length !== req.edges.length) return "route names an edge that does not exist";
      return edges.length && orientRoute(this.graph, req.edges, req.gate) ? null : `route is not a connected path to ${gate?.name ?? req.gate}`;
    },

    // The geospatial check: does any edge of the route touch a closure in force?
    closure: async ({ req, edges }) => {
      const active = this.state.activeZones();
      if (!active.length) return null;
      const hits = await Promise.all(edges.map(async (edge, i) => {
        const line = i === 0 && req.ahead ? req.ahead : edge.geometry.coordinates;
        const zone = await this.database.col.zones.findOne(
          { _id: { $in: active }, geometry: { $geoIntersects: { $geometry: { type: "LineString", coordinates: line } } } },
          { projection: { _id: 1 } },
        );
        return zone ? `closure ${zone._id} on ${edge.name}` : null;
      }));
      const found = [...new Set(hits.filter((h) => h !== null))];
      return found.length ? `route crosses ${found.join(" and ")}` : null;
    },

    gate_occupied: async ({ req }) => {
      const gate = this.graph.nodes.find((n) => n._id === req.gate);
      const other = gate ? await this.database.col.vehicles.findOne({ _id: { $ne: req.vehicle_id }, ...holdsGate(gate) }) : null;
      return other ? `${gate?.name ?? req.gate} is assigned to ${other.details.flight}` : null;
    },

    // Identity-scoped permission: the agent may only use edge kinds it holds a `route:<kind>` clearance for.
    clearance: ({ req, agent, edges }) => {
      const held: string[] = agent?.clearances ?? [];
      const outside = edges.filter((e) => !held.includes(`route:${e.kind}`));
      if (!outside.length) return null;
      return `${req.agent_id} is not cleared for ${[...new Set(outside.map((e) => `${e.kind.replace("_", " ")} (${e.name})`))].join(", ")}`;
    },

    default: () => null,
  };

  /** Decide without recording. Deny beats needs-approval; needs-approval beats allow. */
  async evaluate(req: RouteRequest): Promise<Verdict> {
    const [policies, agent] = await Promise.all([
      this.database.col.policies.find({ applies_to: "route_request", active: { $ne: false } }).sort({ _id: 1 }).toArray(),
      this.database.col.identities.findOne({ _id: req.agent_id }),
    ]);
    const byId = new Map(this.graph.edges.map((e) => [e._id, e]));
    const ctx: Context = { req, agent, edges: req.edges.map((id) => byId.get(id)).filter((e) => e !== undefined) };

    const broken: { policy: Doc; why: string }[] = [];
    await Promise.all(policies.map(async (policy) => {
      const why = await this.rules[policy.rule]?.(ctx, policy);
      if (why) broken.push({ policy, why });
    }));
    broken.sort((a, b) => a.policy._id.localeCompare(b.policy._id));

    const verdict = (decision: Decision, hits: { policy: Doc; why: string }[], suffix = ""): Verdict => ({
      decision, policy_ids: hits.map((h) => h.policy._id), rules: hits.map((h) => h.policy.rule),
      reason: hits.map((h) => h.why).join("; ") + suffix,
    });
    const deny = broken.filter((b) => b.policy.effect === "deny");
    if (deny.length) return verdict("deny", deny);
    const needs = broken.filter((b) => b.policy.effect === "needs_approval");
    if (needs.length && !req.approved) return verdict("needs_approval", needs, "; supervisor approval required");

    const allow = policies.filter((p) => p.effect === "allow");
    return {
      decision: "allow", rules: allow.map((p) => p.rule),
      // The validator requires a policy reference on every action, allowed ones included.
      policy_ids: allow.length ? allow.map((p) => p._id) : ["P-none-broken"],
      reason: req.approved && needs.length ? `approved by a supervisor (${needs.map((n) => n.policy._id).join(", ")}); no other rule broken` : "within clearances, clear of closures, gate free",
    };
  }

  /** Decide and record. The `actions` validator refuses a record without an identity, a decision or a policy reference. */
  async decide(req: RouteRequest): Promise<{ action: Doc; verdict: Verdict }> {
    const verdict = await this.evaluate(req);
    const action: Doc = {
      _id: `A-${String(this.next++).padStart(4, "0")}`, run_id: this.state.run()._id, agent_id: req.agent_id, type: "route_request",
      payload: { vehicle_id: req.vehicle_id, edges: req.edges },
      decision: verdict.decision, policy_ids: verdict.policy_ids, reason: verdict.reason, ts: new Date(),
    };
    await this.database.col.actions.insertOne(action);
    return { action, verdict };
  }
}
