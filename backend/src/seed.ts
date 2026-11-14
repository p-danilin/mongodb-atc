/**
 * One-off Atlas setup: `npm run seed`. Safe to run again.
 *
 * Loads the airport graph and identities from docs/contract/seed.json, and creates the indexes and the
 * validator that do the enforcing. It replaces `nodes` and `edges`, upserts seed `identities` and `policies`, and leaves
 * every other collection's documents alone.
 */
import seed from "../../docs/contract/seed.json" with { type: "json" };
import { config } from "./config";
import { COLLECTIONS, connect, type Doc } from "./db";

/** An action cannot be stored without an identity, a decision and a policy reference. */
const actionValidator = {
  $jsonSchema: {
    bsonType: "object",
    required: ["_id", "run_id", "agent_id", "type", "payload", "decision", "policy_ids", "reason", "ts"],
    properties: {
      _id: { bsonType: "string" },
      run_id: { bsonType: "string" },
      agent_id: { bsonType: "string" },
      type: { enum: ["route_request"] },
      payload: {
        bsonType: "object",
        required: ["vehicle_id", "edges"],
        properties: { vehicle_id: { bsonType: "string" }, edges: { bsonType: "array", items: { bsonType: "string" } } },
      },
      decision: { enum: ["allow", "deny", "needs_approval"] },
      policy_ids: { bsonType: "array", minItems: 1, items: { bsonType: "string" } },
      reason: { bsonType: "string" },
      ts: { bsonType: "date" },
    },
  },
};

/**
 * The rules the policy gate applies to every route request. They are data: the gate reads them on each
 * decision, so setting `active: false` on one changes what the agent may do without a deploy.
 */
const policies: Doc[] = [
  { _id: "P-identity", rule: "identity", effect: "deny", description: "Only an active agent identity may request a route" },
  { _id: "P-run-halted", rule: "run_halted", effect: "deny", description: "No route may be granted while the run is halted" },
  { _id: "P-route-connected", rule: "connected", effect: "deny", description: "A route must be a connected path that ends at the vehicle's gate" },
  { _id: "P-closure", rule: "closure", effect: "deny", description: "A route may not touch a closure in force ($geoIntersects)" },
  { _id: "P-gate-occupied", rule: "gate_occupied", effect: "deny", description: "A gate may be assigned to one vehicle at a time" },
  { _id: "P-runway-crossing", rule: "clearance", effect: "needs_approval", description: "Edges outside the agent's clearances (the runway and its crossing) need supervisor approval" },
  { _id: "P-taxi-clear", rule: "default", effect: "allow", description: "A route that breaks no rule is allowed" },
].map((p) => ({ ...p, applies_to: "route_request", active: true }));

const { client, db, col } = await connect();
try {
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  console.log(`db "${config.dbName}": ${existing.size ? `existing collections: ${[...existing].sort().join(", ")}` : "empty"}`);

  // Collection options that do the enforcing. Pre/post images let the replay show what a change replaced.
  const options: Partial<Record<(typeof COLLECTIONS)[number], Record<string, unknown>>> = {
    actions: { validator: actionValidator, validationLevel: "strict", validationAction: "error" },
    vehicles: { changeStreamPreAndPostImages: { enabled: true } },
    zones: { changeStreamPreAndPostImages: { enabled: true } },
  };
  for (const name of COLLECTIONS) {
    const opts = options[name];
    if (!existing.has(name)) { await db.createCollection(name, opts); continue; }
    if (!opts) continue;
    try { await db.command({ collMod: name, ...opts }); }
    catch (e: any) {
      // A readWrite user may create collections with options but not modify them: recreate if nothing is lost.
      if (e.codeName !== "Unauthorized") throw e;
      if (await col[name].countDocuments({}, { limit: 1 })) { console.warn(`${name}: has documents and collMod is not permitted; options left unchanged`); continue; }
      await col[name].drop();
      await db.createCollection(name, opts);
    }
  }

  await col.nodes.deleteMany({});
  await col.nodes.insertMany(seed.graph.nodes as Doc[]);
  await col.edges.deleteMany({});
  await col.edges.insertMany(seed.graph.edges as Doc[]);
  for (const identity of seed.identities as Doc[]) await col.identities.replaceOne({ _id: identity._id }, identity, { upsert: true });

  for (const policy of policies) await col.policies.replaceOne({ _id: policy._id }, policy, { upsert: true });

  await col.nodes.createIndex({ location: "2dsphere" });
  await col.edges.createIndex({ geometry: "2dsphere" });
  await col.zones.createIndex({ geometry: "2dsphere" });
  await col.zones.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 }); // TTL: closures remove themselves
  await col.vehicles.createIndex({ position: "2dsphere" });
  await col.actions.createIndex({ run_id: 1, ts: 1 });
  await col.approvals.createIndex({ resolves: 1 }, { unique: true }); // an action can be resolved once
  await col.vehicles.createIndex({ "details.gate": 1 });
  await col.ledger.createIndex({ run_id: 1, n: 1 }, { unique: true });

  console.log(`seeded ${seed.graph.nodes.length} nodes, ${seed.graph.edges.length} edges, ${seed.identities.length} identities, ${policies.length} policies; indexes and the actions validator are in place`);
} finally {
  await client.close();
}
