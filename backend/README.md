# Brain (backend)

Node + TypeScript, the MongoDB Node driver and `ws`. Serves the contract in `docs/contract/` from Atlas. Shapes are imported from `docs/contract/types.ts`.

## Run

Needs MongoDB as a replica set. Start the local one from the repo root with `docker compose up -d --wait` (see the root README). With no `.env`, Brain uses it. To use Atlas, set `MONGODB_URI` (and optionally `MONGODB_DB`) in the repo-level `.env`.

```sh
cd backend
npm install
npm run seed   # one-off Atlas setup: graph, identities, indexes, validator (safe to re-run)
npm run dev    # Brain on http://localhost:4100, restarts on change
npm test       # Vitest unit tests (planner)
```

Brain listens on port 4100, which is Tower's default API URL. Override with `PORT`, `TICK_MS`, `STEP_M`.

Re-run `npm run seed` after pulling Brain changes. The policies live in the database, so if they are missing the policy gate allows everything. `node scripts/e2e-levels-1-2.mjs` (repo root) checks Levels 1 and 2 against a running Brain and says so if the policies are missing.

## Built so far

Every endpoint and websocket event in `docs/contract/api.md` is implemented.

- **Level 0:** graph, state, flights, reset, live positions.
- **Level 1:** closures (`POST`/`DELETE /api/zones`), rerouting, the ledger.
- **Level 2:** the policy gate, `actions` records, approvals, halt and resume, the red-team endpoint.

```sh
B=localhost:4100; J='content-type: application/json'
curl -XPOST $B/api/flights -H "$J" -d '{"gate":"G2"}'        # allowed: taxis to Gate 2
curl -XPOST $B/api/flights -H "$J" -d '{"gate":"G2"}'        # denied (gate occupied): the controller picks another gate
curl -XPOST $B/api/flights -H "$J" -d '{"gate":"G5"}'        # needs approval: Gate 5 is across the runway
curl "$B/api/approvals?status=pending"
curl -XPOST $B/api/approvals/A-0003 -H "$J" -d '{"decision":"approve","note":"runway clear"}'
# close taxiway A between T2 and T3 for 60 s: anything routed along it reroutes
curl -XPOST $B/api/zones -H "$J" -d '{"type":"closure","ttl_seconds":60,"reason":"Disabled aircraft on taxiway A","geometry":{"type":"Polygon","coordinates":[[[-79.6325,43.6757],[-79.6315,43.6757],[-79.6315,43.6767],[-79.6325,43.6767],[-79.6325,43.6757]]]}}'
curl -XPOST $B/api/redteam/bad-route                          # a route through the closure: denied and recorded
curl -XPOST $B/api/run/halt -H "$J" -d '{"reason":"demo"}'    # everything freezes
curl -XPOST $B/api/run/resume
curl $B/api/ledger                                            # the whole run, in order
curl -XPOST $B/api/sim/reset
npx wscat -c ws://$B/ws
```

## How it works

- The API and the sim only **write to Mongo**. `src/stream.ts` watches one database-level change stream and relays each change as a contract event, so the map shows what the database says. One stream gives a total order across collections.
- `src/sim.ts` advances each moving vehicle one waypoint per tick and writes its position.
- `src/planner.ts` is the deterministic shortest-path planner, including plans that start part-way along an edge (pure functions, unit tested).
- `src/world.ts` holds the scenario operations and the controller: spawn, zones, approvals, halt, reset, snapshot. A reset opens a new run (`R-2`, `R-3`, ...) and keeps the old runs with their actions and ledgers.
- `src/ledger.ts` appends to the insert-only `ledger`, numbered per run.
- `src/seed.ts` creates the 2dsphere indexes, the TTL index on `zones.expires_at`, the `$jsonSchema` validator on `actions`, and pre/post images on `vehicles` and `zones`.

### Closures

- **Geo check.** `$geoIntersects` finds the edges a new zone's polygon touches. For the edge a vehicle is on, the stretch ahead of it (and the stretch behind) is checked against `zones` the other way round, so a closure behind a vehicle does not stop it.
- **Replan.** The vehicle either carries on to the end of its edge or turns back, whichever is clear and shorter. The new route goes through the policy gate like any other; once allowed it is written to the vehicle (a `vehicle.moved`) with a `route.replanned` ledger entry.
- **Expiry.** A zone stops applying at `expires_at`. Mongo's TTL monitor deletes the document, but it only sweeps about once a minute, so the server sends `zone.expired` on time and the later TTL delete is silent. This is the one event not driven by a database change. `GET /api/state` returns only zones still in force.
- **Bad polygons** are refused by the 2dsphere index on insert and come back as `400`.

### The policy gate (`src/gate.ts`)

Nothing moves without an `allow`. Every route request, from the controller or the red-team button, goes through `Gate.decide`, which stores an `actions` document: who asked (`agent_id`), what for (`payload`), the `decision`, the `policy_ids` behind it and the `reason`. Actions are never updated.

The rules are documents in `policies`, read on every decision. Set `active: false` on one and the gate stops applying it.

| Policy | Effect | Rule |
| --- | --- | --- |
| `P-identity` | deny | The requester must be an active `agent` identity |
| `P-run-halted` | deny | Nothing is granted while the run is halted |
| `P-route-connected` | deny | The route must be a connected path ending at the vehicle's gate |
| `P-closure` | deny | No edge may touch a closure in force (`$geoIntersects`) |
| `P-gate-occupied` | deny | A gate is assigned to one vehicle at a time |
| `P-runway-crossing` | needs approval | Edge kinds outside the agent's `route:<kind>` clearances need a supervisor |
| `P-taxi-clear` | allow | A route that breaks no rule |

Deny beats needs-approval, which beats allow.

### The controller (`World.dispatch`)

When a flight arrives, a closure lands on a route, a closure lifts or an approval is answered, the controller works out the routes on offer (no-approval routes first, then by length), requests them from the gate in turn and acts on the answer:

- **allow:** write the route and move.
- **needs approval:** stop, status `awaiting_approval`, wait for `POST /api/approvals/:id`. An approval is a new `approvals` record; on approve the gate checks the route again, since the airport may have changed.
- **deny:** try the next route. If the gate is occupied, pick the nearest free gate. If nothing is permitted, hold position and retry when a closure goes away.

The controller is deterministic today. The LLM controller replaces the choosing and explaining in `dispatch`; the planner, the gate and the records stay as they are.

### Halt

`POST /api/run/halt` stops the sim, sets every vehicle to `halted` and makes the gate deny everything (`P-run-halted`). Spawning and resolving approvals return `409` until `POST /api/run/resume`.

## Not built

- The LLM controller (needs `ANTHROPIC_API_KEY`).
- Level 3: vehicles do not see each other, so two can share a taxiway.
- An endpoint to show the validator rejecting a write (the "under-the-hood" panel is deferred in the contract).

## One Brain per database

The sim, the id counters and the websocket `seq` live in the server process. Two Brains pointed at the same database will move each other's vehicles. Give each developer their own `MONGODB_DB` (for example `ground_control_<name>`) and run `npm run seed` against it.

## Atlas notes

The sandbox database user can create collections with options but cannot run `collMod`. The seed therefore sets the validator and pre/post images at creation time, and recreates a collection only if it is empty.
