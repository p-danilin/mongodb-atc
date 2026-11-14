# Brain (backend)

Node + TypeScript, the MongoDB Node driver and `ws`. Serves the contract in `docs/contract/` from Atlas. Shapes are imported from `docs/contract/types.ts`.

## Run

Needs `MONGODB_URI` (and optionally `MONGODB_DB`) in the repo-level `.env`.

```sh
cd backend
npm install
npm run seed   # one-off Atlas setup: graph, identities, indexes, validator (safe to re-run)
npm run dev    # Brain on http://localhost:4100, restarts on change
npm test       # Vitest unit tests (planner)
```

Brain uses port 4100 so it can run beside the mock (4000). Point Tower at it with `VITE_API_URL=http://localhost:4100`. Override with `PORT`, `TICK_MS`, `STEP_M`.

## Level 0 (built)

`GET /api/graph`, `GET /api/state`, `POST /api/sim/start`, `POST /api/sim/reset`, `POST /api/flights`, and `/ws` with `vehicle.spawned`, `vehicle.moved` and `sim.reset`.

```sh
curl localhost:4100/api/state
curl -XPOST localhost:4100/api/flights -H 'content-type: application/json' -d '{"gate":"G1"}'
curl -XPOST localhost:4100/api/sim/reset
npx wscat -c ws://localhost:4100/ws
```

## How it works

- The API and the sim only **write to Mongo**. Nothing is sent to the websocket directly.
- `src/stream.ts` watches one database-level change stream and relays each change as a contract event, so the map shows what the database says. One stream gives a total order across collections.
- `src/sim.ts` advances each moving vehicle one waypoint per tick and writes its position.
- `src/planner.ts` is the deterministic shortest-path planner (pure functions, unit tested).
- `src/world.ts` holds the scenario operations (spawn, reset, snapshot). A reset opens a new run (`R-2`, `R-3`, ...) and keeps the old ones.
- `src/seed.ts` creates the 2dsphere indexes, the TTL index on `zones.expires_at`, the `$jsonSchema` validator on `actions`, and pre/post images on `vehicles` and `zones`.

## Layout for the next levels

- **Level 1:** zone endpoints in `server.ts`; `zones` events in `stream.ts`; pass closed edges to `findRoute` via `avoidEdges` (found with `$geoIntersects`).
- **Level 2:** the policy gate in front of `sim.follow`, `actions` and `ledger` writes, approvals, halt and resume, the red-team endpoint, then the LLM controller.

## Atlas notes

The sandbox database user can create collections with options but cannot run `collMod`. The seed therefore sets the validator and pre/post images at creation time, and recreates a collection only if it is empty.
