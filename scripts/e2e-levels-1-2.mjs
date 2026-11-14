#!/usr/bin/env node
// End to end check of Levels 1 and 2 against a local Brain (default http://localhost:4100).
//   node scripts/e2e-levels-1-2.mjs            (or API_URL=http://host:port node ...)
// Steps: reset, spawn at Gate 5 (needs approval), approve, drop a closure on the route (reroute),
// halt (spawn refused), resume, then check the ledger holds each step in order.
// Resets the current run, so do not point it at a scenario you want to keep.

const API = (process.env.API_URL ?? "http://localhost:4100").replace(/\/$/, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Failure extends Error {}
const fail = (msg) => { throw new Failure(msg); };
const step = (msg) => console.log(`ok  ${msg}`);

async function call(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch((e) => fail(`Cannot reach Brain at ${API} (${e.cause?.code ?? e.message}). Start it with: cd backend && npm run dev`));
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  return { status: res.status, data };
}
const ok = async (method, path, body) => {
  const r = await call(method, path, body);
  if (r.status >= 300) fail(`${method} ${path} -> ${r.status}: ${r.data?.error?.message ?? "no message"}`);
  return r.data;
};

async function until(what, fn, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) fail(`Timed out waiting for ${what}`);
    await sleep(250);
  }
}

const RESEED = "Brain is not enforcing policies. Re-seed the database (cd backend && npm run seed) and restart Brain.";

async function main() {
  const graph = await ok("GET", "/api/graph");
  const edgeById = new Map(graph.edges.map((e) => [e._id, e]));

  const run = await ok("POST", "/api/sim/reset");
  step(`reset: new run ${run._id}`);

  const vehicle = await ok("POST", "/api/flights", { gate: "G5" });
  const pending = await until("an approval for the Gate 5 flight", async () => {
    const list = await ok("GET", "/api/approvals?status=pending");
    return list.find((a) => a.payload.vehicle_id === vehicle._id);
  }).catch((e) => { throw e instanceof Failure ? new Failure(`${e.message}. ${RESEED}`) : e; });
  if (pending.decision !== "needs_approval") fail(`Gate 5 route was ${pending.decision}, expected needs_approval. ${RESEED}`);
  step(`spawn: ${vehicle._id} to Gate 5 needs approval (${pending.policy_ids.join(", ")}, ${pending._id})`);

  await ok("POST", `/api/approvals/${pending._id}`, { decision: "approve", note: "e2e: runway clear" });
  step(`approve: ${pending._id} resolved`);

  const moving = await until("the approved flight to start moving", async () => {
    const s = await ok("GET", "/api/state");
    const v = s.vehicles.find((x) => x._id === vehicle._id);
    return v && v.status === "moving" && v.route.length >= 3 ? v : null;
  });
  // A closure on an edge ahead of the vehicle: the second one of its route.
  const target = edgeById.get(moving.route[Math.min(2, moving.route.length - 1)]);
  const [lon, lat] = target.geometry.coordinates[Math.floor(target.geometry.coordinates.length / 2)];
  const d = 0.00012;
  const zone = await ok("POST", "/api/zones", {
    type: "closure", ttl_seconds: 120, reason: `e2e: closure on ${target.name}`,
    geometry: { type: "Polygon", coordinates: [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]] },
  });
  step(`closure: ${zone._id} dropped on edge ${target._id}`);

  await until("a reroute or a new decision after the closure", async () => {
    const entries = await ok("GET", `/api/ledger?run_id=${run._id}`);
    const at = entries.findIndex((e) => e.event === "zone.created");
    return entries.slice(at + 1).some((e) => e.event === "route.replanned" || e.event === "action.decided");
  });
  step("replan: the controller reacted to the closure");

  await ok("POST", "/api/run/halt", { reason: "e2e" });
  const refused = await call("POST", "/api/flights", { gate: "G2" });
  if (refused.status !== 409) fail(`Spawning while halted returned ${refused.status}, expected 409`);
  step(`halt: spawn refused (409: ${refused.data?.error?.message})`);

  await ok("POST", "/api/run/resume");
  step("resume: run is running again");

  // Ledger writes are asynchronous; wait for the last step to land.
  const entries = await until("the ledger to hold run.resumed", async () => {
    const list = await ok("GET", `/api/ledger?run_id=${run._id}`);
    return list.some((e) => e.event === "run.resumed") ? list : null;
  });
  if (entries.some((e, i) => e.n !== i + 1)) fail("Ledger numbers are not 1..n in order");
  const expected = ["vehicle.spawned", "action.decided", "approval.resolved", "zone.created", "run.halted", "run.resumed"];
  let from = 0;
  for (const event of expected) {
    const at = entries.findIndex((e, i) => i >= from && e.event === event);
    if (at < 0) fail(`Ledger has no "${event}" entry after position ${from}. Events seen: ${entries.map((e) => e.event).join(", ")}`);
    from = at + 1;
  }
  step(`ledger: ${entries.length} entries in order (${expected.join(" > ")})`);
  console.log("PASS");
}

main().catch((e) => {
  console.error(`FAIL ${e instanceof Failure ? e.message : e.stack ?? e}`);
  process.exit(1);
});
