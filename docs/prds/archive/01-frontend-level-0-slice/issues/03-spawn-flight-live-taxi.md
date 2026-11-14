# 03. Spawn a flight and watch the Vehicle taxi live

Type: AFK · Labels: ready-for-agent

## Parent

[`../prd.md`](../prd.md): user stories 6–10, 20, 24–26, 35, 38, 39.

## What to build

The live path, end to end, with the happy-path sync only (resync edge cases come in `05-resync-on-gap-reconnect-reset`). Vehicle movement may jump between updates here; smoothing is `04-smooth-vehicle-motion`.

- Mock server: a websocket at `/ws` using the real envelope (`type`, `seq` +1 per message, `ts`, `data`); `POST /api/flights` spawning a Vehicle at the requested gate's scenario and emitting `vehicle.spawned`; a scripted taxi from runway exit RX1 to the gate along the graph at a 500 ms tick, emitting `vehicle.moved` with updated position, heading from the current edge direction, `route`, and `status` (`moving`, then `idle` on arrival). The snapshot's `seq` matches the websocket counter.
- State reducer: a pure function applying a snapshot or any `WsMessage` to state. Covers every message type in the contract; replacing a Vehicle by `_id` is idempotent; message types not used yet must not throw. Unit tested.
- Snapshot-and-stream sync, happy path: fetch the snapshot, buffer websocket messages while it loads, drop buffered messages with `seq <=` snapshot `seq`, apply the rest in order. Takes a transport so it can be tested with a fake. Unit tested for the buffering and dropping rules.
- API client wrappers (typed) for the Level 0 endpoints.
- Store: Vehicle positions are held outside React state; other state (zones, approvals, run) is normal React state.
- Map: draws each Vehicle at its position and highlights its planned route from `vehicle.route` and the graph's edge geometry. A "Spawn flight" control (gate choice) calls the API.

## Acceptance criteria

- [ ] With the mock and dev server running, choosing Gate 1 and spawning a flight makes a Vehicle appear and move from RX1 to G1 along the graph, ending `idle`.
- [ ] The route highlight shows the planned edges and updates when `route` changes.
- [ ] Mock messages have `seq` increasing by exactly one, and the snapshot `seq` is consistent with the stream.
- [ ] Reducer tests cover each contract message type, idempotent replacement, and snapshot replacement.
- [ ] Sync tests (fake transport) cover: messages arriving before the snapshot, buffered messages with `seq <=` snapshot `seq` dropped, the rest applied in order.
- [ ] React does not re-render on each Vehicle position update (verified by inspection or a render counter).
- [ ] The mock is structured so zones, approvals and halt can be added later without a rewrite.

## Blocked by

- 02-airport-map-from-mock-graph
