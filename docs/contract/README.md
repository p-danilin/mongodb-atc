# Contract (draft)

Files: [`types.ts`](./types.ts) (all shapes), [`api.md`](./api.md) (endpoints, websocket, client rules), [`seed.json`](./seed.json) (invented airport near Toronto, 14 nodes, 17 edges, one aircraft, one sample zone).

Agreed between Brain (backend) and Tower (frontend). Changing anything here means telling the other person first. Terms are defined in `/CONTEXT.md`.

## Decisions so far

- **Vehicle, not aircraft.** The moving thing is a **Vehicle** with `kind` of `aircraft | fuel_truck | tug`. Collection is `vehicles`; event is `vehicle.moved`. This replaces `aircraft` / `aircraft.moved` in `docs/mvp-plan.md`.
- **Base plus details.** Every Vehicle has base fields `_id`, `kind`, `identity_id`, `position`, `heading`, `route`, `status`, `run_id`, plus a `details` object whose shape depends on `kind`. Modelled as a TypeScript discriminated union on `kind`.
  - `aircraft` details at Level 0: `flight`, `gate`.
- **Position stream.** The sim writes `position` (GeoJSON Point) to Mongo every tick; the change stream relays it as `vehicle.moved`. Tick is a config value, default 500 ms. The UI interpolates between updates; it does not rely on a faster tick for smoothness.
- **Position is not ledgered.** The ledger records decisions (route requests, approvals, halts), not positions.
- **Websocket envelope.** Every message is `{ type, seq, ts, data }`. `seq` increments by one per message. On a gap in `seq` or on reconnect, the UI refetches `GET /api/state` and resumes.
- Coordinates are `[longitude, latitude]` GeoJSON everywhere.
- **Projection.** `GET /api/graph` returns `bounds` as `[minLon, minLat, maxLon, maxLat]` with nodes and edges. The UI projects linearly onto the SVG viewBox, flips y, and scales longitude by `cos(lat)`. The same inverse is used to turn drawn zones back into `[lon, lat]`.
- **Seed airport** is invented, small (under about 2 km across), and placed at real-looking coordinates near Toronto.
- **Zone creation is click-to-drop.** `POST /api/zones` takes `{ geometry, type, ttl_seconds, reason }`, where `geometry` is a GeoJSON Polygon. The UI generates a small polygon around the clicked point; zone `type` starts as `closure` only. The polygon is the source of truth for the geo check; images are UI-only.
- **Images are a UI concern.** The UI maps vehicle `kind` and zone `type` to sprite assets. Generated polygon size should match the icon's visual footprint so what is drawn is what `$geoIntersects` tests.
- **Heading.** Vehicle base fields include `heading` (degrees, 0 = north, clockwise), set by the sim from the current edge direction and written with each position update. A stationary vehicle keeps its last heading.
- **Vehicle status has four values:** `idle`, `moving`, `awaiting_approval`, `halted`. `halted` is stored on each Vehicle as well as on the run. Denials are carried by `action.decided` (decision `deny`) and reroutes by a new `route` on the Vehicle plus a ledger entry; neither is a status.
- **Approvals are append-only.** An action stays `needs_approval` forever. Approving or denying writes a new resolution record with `resolves: "<action id>"`, the approver's identity, the decision and `ts`, and emits a new `approval.resolved` event. `POST /api/approvals/:id` takes `{ decision: "approve" | "deny", note? }`. The server decides which approvals are still pending; `GET /api/approvals?status=pending` is the source for the queue.
- **Snapshot carries `seq`.** `GET /api/state` returns `{ seq, vehicles, zones, pending_approvals, run }`, where `seq` is the websocket counter at snapshot time. The UI buffers websocket messages while the snapshot loads, applies the snapshot, drops buffered messages with `seq <= snapshot.seq`, then applies the rest in order.

## Deferred (not in the frozen contract)

- **Under-the-hood panel data.** Possible optional `source: { collection, op }` on the envelope and a `write.rejected` event. To be designed once the Atlas implementation is clearer; the panel itself may change. The envelope can gain optional fields without breaking the map or feed.

## Defaults chosen without discussion (Brain to review)

- **Dates** are ISO strings on the wire; ids are strings (`V-1`, `Z-014`, `A-0231`, `R-1`).
- **Added events** beyond the plan: `vehicle.spawned`, `zone.removed` (early delete; `zone.expired` stays TTL-only), `approval.resolved`, `sim.reset`. `vehicle.moved` fires on any vehicle update (position, heading, route, status).
- **Edge kinds** `taxiway | apron | runway | runway_crossing`. The seed has one crossing (`E10`) so a gate on the north side (G5, G6) forces a needs-approval route. A closure on `E2` forces a reroute to Gate 2 via the apron links.
- **Identity kinds** are `agent | vehicle | human` (the plan said `aircraft`; renamed with Vehicle). `supervisor-1` is the human; there is no auth.
- **Ledger** entries use `n` for per-run order, so it is not confused with the websocket `seq`. Action payloads use `vehicle_id` instead of the plan's `aircraft`.
- **Errors** are `{ error: { code, message } }` with 400, 404 or 409.
- **Run data** (`sim/start`, `sim/reset`) return the `Run`; the seed has `zones: []` and keeps the sample zone separate so Level 0 starts clean.
