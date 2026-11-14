# Ground Control Agent: MVP Plan

Nov 13, 2026 · @Peter Danilin

## Pitch

Ground Control is an air-traffic-style agent that moves aircraft around an airport map under rules MongoDB enforces: every move is checked before it happens and recorded after, so a reviewer can replay the whole run.

We are building for **Problem 1, Agents You Can Audit**, using Atlas as the identity, policy and audit layer. The Atlas features the judges should see doing real work:

- **Geospatial queries** (`$geoIntersects`) decide whether a route touches a closed zone.
- **TTL indexes** make temporary closures expire on their own.
- **Change streams** push every move and decision to the live map.
- **Schema validation** rejects any action record that lacks an identity, a decision or a policy reference.
- **Vector Search** (stretch) lets the agent recall how it rerouted around a similar closure before.

The agent is the ground controller. Aircraft are simulated, so no pilots are involved.

## MVP levels and cut list

The MVP is Levels 0 to 2 working end to end. Each level is a demo we can show on its own, so we always have something to present.

| Level | Name | What works | What it proves |
| --- | --- | --- | --- |
| 0 | Taxi | One aircraft moves from the runway exit to a gate along the taxiway graph, live on the map | Live state flows through Mongo and change streams |
| 1 | Closure | A person drops a closure zone on the map; the controller agent replans around it | Geospatial check and rerouting |
| 2 | Clearance | Every route request gets allow, deny or needs-approval; approvals queue; ledger; halt button | Policy enforced before the action, audit after (the MVP finish line) |
| 3 | Traffic | 3 to 5 vehicles (aircraft, fuel truck, tug) with different clearances and hold-short conflicts | Identities and scoped permissions |
| 4 | Memory and voice | Vector Search recall of past reroutes; ElevenLabs radio voice; replay scrubber | Agent memory; sponsor prize angle |

**Cut list (do not build unless Level 2 is done):**

- Real map tiles (draw the airport as SVG from our graph)
- Physics, collisions, wind
- More than one airport
- Login and auth
- One LLM agent per vehicle (one controller agent only)
- Mobile layout

## Architecture and the contract-first rule

We can work in parallel because the backend and the UI only meet at two things: the Mongo collections and a small API. We agree on both in the first 45 minutes, then neither of us waits on the other.

&#91;embedded content: architecture · UI, API, Atlas, backend\]

Tower only talks to the API; Brain writes to Atlas, and change streams carry every write back to the map.

- **Contract first.** One shared folder holds the API spec and a `seed.json` (airport graph, sample aircraft, sample zone). Changing it means telling the other person.
- **Tower works against a mock server** that serves `seed.json`, so the map is built before the real backend exists.
- **Brain tests with a CLI or curl**, so the agent and gate are built before the UI exists.
- **Default stack:** Node and TypeScript end to end (shared types), React with Vite, and the MongoDB Node driver. Use what you both know if it differs.

**How the agent works (kept simple on purpose):**

1. An event wakes the controller agent, such as a flight needing a gate or a zone appearing.
2. The agent calls tools: `get_state`, `plan_route` (a plain shortest-path search that avoids active zones), and `request_route`.
3. `request_route` always goes through the policy gate. The gate returns allow, deny or needs-approval with a reason.
4. The agent explains the outcome and adapts. Every step is written to the ledger.

Route planning is deterministic, so the LLM only chooses and explains. That keeps the demo fast and predictable.

## MongoDB data model

Nine collections cover Levels 0 to 3; a tenth (`incidents`) is only for the Vector Search stretch. Objects are documents, and so are the airport's rules and the agent's interactions.

| Collection | Holds | Key fields | Mongo feature |
| --- | --- | --- | --- |
| `nodes` | Gates, taxiway junctions, runway exits | type, location (Point) | 2dsphere index |
| `edges` | Taxiway segments between nodes | from, to, geometry (LineString), length | 2dsphere index |
| `zones` | Closures and hazards | type, geometry (Polygon), reason, created\_by, expires\_at | 2dsphere + TTL index |
| `identities` | Who may do what | kind (agent, aircraft, vehicle), clearances, active | Role-style scoping |
| `aircraft` | Live vehicles | identity\_id, position (Point), route, status, run\_id | Change stream |
| `policies` | Rules the gate applies | rule, applies\_to, effect (deny or needs\_approval), params | Queried by the gate |
| `actions` | Every proposed action and its decision | agent\_id, payload, decision, policy\_ids, reason, ts | `$jsonSchema` validator |
| `ledger` | Append-only event log | run\_id, seq, ts, actor, event, ref | Insert-only for the agent |
| `runs` | State of a run | status (running or halted), started\_at, halted\_by | Change stream drives the halt |

**A zone document:**

```json
{
  "_id": "Z-014",
  "type": "closure",
  "reason": "Disabled aircraft on taxiway B",
  "geometry": { "type": "Polygon", "coordinates": [[[-79.62, 43.68], [-79.61, 43.68], [-79.61, 43.69], [-79.62, 43.69], [-79.62, 43.68]]] },
  "created_by": "supervisor-1",
  "expires_at": { "$date": "2026-11-14T15:00:00Z" }
}
```

**An action document (what the gate writes):**

```json
{
  "_id": "A-0231",
  "run_id": "R-1",
  "agent_id": "controller-1",
  "type": "route_request",
  "payload": { "aircraft": "AC101", "edges": ["E4", "E7", "E9"] },
  "decision": "needs_approval",
  "policy_ids": ["P-runway-crossing"],
  "reason": "Route crosses active runway; supervisor approval required",
  "ts": { "$date": "2026-11-14T14:32:10Z" }
}
```

**How Mongo does the enforcing:**

- **Gate check:** for each edge in a proposed route, query `zones` with `$geoIntersects` against the edge geometry. Any active closure hit means deny. (This check is a query in the gate; the validator only guarantees the record's shape.)
- **Validator:** `actions` requires `agent_id`, `decision`, `policy_ids` and `ts`, so an undecided action cannot be stored.
- **TTL:** an index on `zones.expires_at` with `expireAfterSeconds: 0` removes closures when they expire. The map gets the delete event through the change stream.
- **Change streams** on `aircraft`, `zones`, `actions` and `runs`. Enable pre- and post-images on `aircraft` and `zones` so the replay can show before and after.
- **Insert-only ledger:** give the agent's database user a custom role with insert (not update or delete) on `ledger` and `actions`. Confirm custom roles are available on your Atlas tier; if not, enforce it in the app and say so honestly in the pitch.

## API and live-event contract

The UI calls a small REST API and listens to one websocket. The server relays Mongo change-stream events, so what the map shows is what the database says. Brain owns this contract; Tower builds against it from the mock server.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/graph` | Nodes and edges, to draw the airport |
| `GET /api/state` | Snapshot: aircraft, active zones, pending approvals, run status |
| `POST /api/sim/start` and `/api/sim/reset` | Start or reset the scenario |
| `POST /api/flights` | Spawn an arriving flight for a gate |
| `POST /api/zones` | Create a zone: geometry, type, ttl\_seconds, reason |
| `DELETE /api/zones/:id` | Remove a zone early |
| `GET /api/approvals?status=pending` | Actions waiting for a human |
| `POST /api/approvals/:id` | Approve or deny |
| `POST /api/run/halt` and `/api/run/resume` | The kill switch |
| `POST /api/redteam/bad-route` | Force a route through a closure, to show the gate denying it |
| `GET /api/ledger?run_id=` | Ordered ledger, for the replay |

**Websocket `/ws` events** (each carries the changed document):

- `aircraft.moved`
- `zone.created` and `zone.expired`
- `action.decided` (allow, deny or needs\_approval)
- `approval.requested`
- `run.halted` and `run.resumed`
- `ledger.appended`

Coordinates are `[longitude, latitude]` GeoJSON everywhere. The map draws them on a flat SVG, so no tile service is needed.

## Roles

The split is by layer, not by feature: one person owns everything behind the API, the other everything in front of it. Each role has plenty to do without the other from minute one.

|  | Brain: backend, agent, sim and policy gate | Tower: frontend, map and control console |
| --- | --- | --- |
| Owns | Atlas setup, collections, indexes, validators, roles | Vite app, airport map, all screens |
| Builds | Simulation tick, route planner, controller agent, policy gate, ledger, approvals and halt logic, change-stream relay to the websocket | Moving aircraft, zone drawing, event feed, approval queue, halt button, denied-action alert, ledger view and replay scrubber |
| Works alone using | curl or a small CLI against the real API | A mock server serving `seed.json` |
| Also owns | The contract and seed files | The under-the-hood panel (live change stream, TTL countdown, rejected write) and the slides |

**Shared:** the contract (first 45 minutes), the demo script, three full rehearsals, and the call on what to cut at the cut line.

**Which role is whose?** Take the one you are stronger at. If you are both full-stack, the person more comfortable with LLM tool calling takes Brain.

## Timeline

Plan for about 8 working hours, counted from the start of building. If the event gives you less, shrink every block proportionally and keep the cut line at about 60 percent. The rule when a milestone slips: simplify the airport graph, never add features.

| Hours | Brain | Tower | Milestone |
| --- | --- | --- | --- |
| 0:00 to 0:45 | Atlas cluster, collections, indexes, seed script | Repo, Vite app, mock server from `seed.json`, SVG airport from the graph | Contract frozen |
| 0:45 to 2:00 | Simulation tick; positions into Mongo; change stream to websocket | Map renders graph; aircraft dot moves from the websocket | **Level 0:** an aircraft taxis live |
| 2:00 to 3:30 | Route planner, controller agent v1, zone model and geo query | Zone drawing, event feed | **Level 1:** drop a closure, aircraft reroutes |
| 3:30 to 5:00 | Policy gate, validator, ledger, approvals API, halt | Approval queue, halt button, denied alert, ledger view | **Level 2:** allow, deny, approve and halt all work. **Cut line at 5:00.** |
| 5:00 to 6:30 | Level 3 (second vehicle and clearances) or Vector Search memory | Under-the-hood panel, replay scrubber | Stretch only if Level 2 is solid |
| 6:30 to last 90 minutes | Bug fixes only | Polish | **Feature freeze** |
| Last 90 minutes | Rehearse the demo three times, record a backup video, finish the slides | Same | Ready to present |

## Three-minute demo script

Every beat shows one Mongo feature doing real work, with the under-the-hood panel open beside the map. Design the build backwards from this script.

1. **0:00, Meet Ground Control.** An aircraft lands and the agent assigns a taxi route. The dot moves; the panel shows the change-stream events arriving.
2. **0:30, Drop a closure.** Place a closure on a taxiway with a 60-second TTL countdown. The agent replans; the ledger entry shows the geo check that triggered it.
3. **1:10, Needs approval.** A route crossing the active runway returns needs-approval. Approve it from the queue and the aircraft continues.
4. **1:40, The agent is stopped.** Press the red-team button. The agent's route through a closed zone is denied, and the record shows the decision and policy id. Try writing an action without a decision and show the validator reject it.
5. **2:10, Halt.** Press halt and the aircraft freezes mid-taxi. Resume, then scrub the ledger replay to show exactly what happened and under whose authority.
6. **2:40, Close.** Atlas is the identity, policy and audit layer. Name the features on screen: geospatial queries, TTL, change streams, validation.

If an LLM call is slow, replay mode runs the same scripted path from saved decisions, so the demo never stalls.

## Risks and pre-hackathon checklist

| Risk | Fallback |
| --- | --- |
| The simulation eats the day | Keep the graph to about 15 nodes. If Level 0 is not working by 2:30, hard-code one path. |
| LLM is slow or flaky | Deterministic planner; the LLM only chooses and explains. Replay mode for the demo. |
| Change streams misbehave | Test today. Fallback: poll every 500 ms and say so. |
| Custom database roles unavailable on our tier | Enforce insert-only in the app and be upfront about it. |
| We step on each other's code | Separate folders; contract changes announced before they land. |
| Venue wifi fails | Run locally and keep a recorded backup video. |

**To do before the event** (keep it to planning and setup; check the rules first):

- [ ] Read the hackathon rules on pre-written code. Until confirmed, limit prep to this plan, accounts and tests, not the project itself.
- [ ] Decide who is Brain and who is Tower.
- [ ] Create the Atlas project and cluster; allow both of our IPs; share the connection string privately, never in the repo.
- [ ] Confirm the stack (default: Node and TypeScript, React with Vite).
- [ ] Get an LLM API key with credits and confirm tool calling works.
- [ ] Run a throwaway ten-line change-stream test on the cluster.
- [ ] Check whether custom roles and Vector Search are available on the cluster tier.
- [ ] Each of us practises explaining the demo in 30 seconds.
