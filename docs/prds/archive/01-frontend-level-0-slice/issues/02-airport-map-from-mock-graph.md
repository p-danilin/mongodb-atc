# 02. Airport map renders from the mock's graph

Type: AFK · Labels: ready-for-agent

## Parent

[`../prd.md`](../prd.md): user stories 1–5, 15–19, 34, 37.

## What to build

The first end-to-end path: a mock HTTP server and a Vite app that draws the airport.

- Vite, React and TypeScript app in the frontend folder, with an `@contract` path alias to the contract folder for types and the seed, and `VITE_API_URL` as the single API base.
- A disposable mock server in its own folder under the frontend, serving `GET /api/graph` and `GET /api/state` from the seed (state carries `seq`). No websocket yet.
- A projection module: pure functions `[lon, lat]` → SVG coordinates and back, using the graph's `bounds`, y flipped (north up), longitude scaled by `cos(lat)`. Unit tested with Vitest.
- An SVG map that draws the static base layer once: edges styled by kind (`taxiway`, `apron`, `runway`, `runway_crossing`), nodes styled by type (`gate`, `junction`, `runway_exit`), with labels. It fits its container and survives resizing.
- A simple app shell with the map as the main area.

Use CONTEXT.md vocabulary (Vehicle, not aircraft) in names and copy.

## Acceptance criteria

- [ ] One command starts the dev server and one command starts the mock (documented in the frontend README).
- [ ] Opening the page shows all 14 nodes and 17 edges from the seed, labelled, with north up and no visible stretching.
- [ ] The runway crossing edge and the runway edges are visually distinct from taxiways and aprons.
- [ ] Changing `VITE_API_URL` points the app at a different server with no code change.
- [ ] Contract types are imported through `@contract`; a change to the contract types breaks the type check.
- [ ] Projection tests pass: bounds corners map to viewBox corners, round trip returns the input, y is flipped, longitude is scaled by `cos(lat)`.
- [ ] Resizing the window keeps the whole map visible.

## Blocked by

None - can start immediately (`01-contract-readme-snapshot-seq` is independent docs work)
