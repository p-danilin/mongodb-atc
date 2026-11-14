# API contract

REST over JSON plus one websocket. Types are in [`types.ts`](./types.ts); the sample data is in [`seed.json`](./seed.json). Brain owns this file; Tower builds against it from the mock server.

Base URL is configurable in the UI (`VITE_API_URL`), so switching from the mock to the real backend is a one-line change. There is no auth. The server acts as `supervisor-1` for every human action.

Errors use `ApiError` with an HTTP status: `400` bad body, `404` unknown id, `409` wrong state (for example resolving an approval twice, or acting while halted).

## REST

| Method and path | Body | Returns |
| --- | --- | --- |
| `GET /api/graph` | | `Graph` |
| `GET /api/state` | | `Snapshot` |
| `POST /api/sim/start` | | `Run` |
| `POST /api/sim/reset` | | `Run` (also emits `sim.reset`) |
| `POST /api/flights` | `SpawnFlightRequest` | `Vehicle` (also emits `vehicle.spawned`) |
| `POST /api/zones` | `CreateZoneRequest` | `Zone` (also emits `zone.created`) |
| `DELETE /api/zones/:id` | | `204` (also emits `zone.removed`) |
| `GET /api/approvals?status=pending` | | `Action[]` |
| `POST /api/approvals/:id` | `ResolveApprovalRequest` | `Resolution` (also emits `approval.resolved`) |
| `POST /api/run/halt` | `HaltRequest` | `Run` (also emits `run.halted`) |
| `POST /api/run/resume` | | `Run` (also emits `run.resumed`) |
| `POST /api/redteam/bad-route` | | `Action` (decision `deny`; also emits `action.decided`) |
| `GET /api/ledger?run_id=` | | `LedgerEntry[]` ordered by `n` |

`:id` in `/api/approvals/:id` is the **action** id. Only actions with decision `needs_approval` and no resolution yet can be resolved.

## Websocket `/ws`

Every message is `WsMessage`: `{ type, seq, ts, data }`. See `types.ts` for the `data` of each type.

| `type` | When |
| --- | --- |
| `vehicle.spawned` | A flight was created |
| `vehicle.moved` | Any update to a vehicle: position, heading, route or status |
| `zone.created` | A closure was dropped |
| `zone.expired` | A closure was removed by TTL |
| `zone.removed` | A closure was removed early |
| `action.decided` | The gate decided on a proposed action: `allow`, `deny` or `needs_approval` |
| `approval.requested` | An action needs a human (also sent as `action.decided`) |
| `approval.resolved` | A human approved or denied |
| `run.halted` / `run.resumed` | Kill switch |
| `sim.reset` | Scenario reset; refetch the snapshot |
| `ledger.appended` | A ledger entry was added |

### Client rules

- **Gap detection.** `seq` goes up by exactly one per message. If the UI sees `seq` jump, or the socket reconnects, it refetches `GET /api/state`.
- **Resync without races.** While the snapshot loads, buffer incoming messages. Apply the snapshot, drop buffered messages with `seq <= snapshot.seq`, apply the rest in order.
- **Reroutes and denials are events, not statuses.** A reroute is a `vehicle.moved` with a new `route` plus a ledger entry. A denial is `action.decided` with `decision: "deny"`; the UI flashes the vehicle and shows the alert.
- **Interpolate.** Ease each vehicle from its previous position to the new one over about one tick (default 500 ms, a server config value). `vehicle.ts` is the time of the write.
- **Halt.** On `run.halted` the server freezes every vehicle and sets each one's status to `halted`. On `run.resumed` they return to `moving` or `idle`.

## Server behaviour the UI relies on

- Coordinates in, coordinates out: `[lon, lat]`. Zones from the UI are generated polygons (click-to-drop); the server does not simplify or snap them.
- `expires_at = now + ttl_seconds` is computed by the server.
- The server decides which approvals are pending. The UI never works it out from the action stream.
- A ledger entry exists for every event in `LedgerEvent`. Vehicle positions are never ledgered.
