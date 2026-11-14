# 05. Clean resync on a `seq` gap, reconnect, or reset

Type: AFK · Labels: ready-for-agent

## Parent

[`../prd.md`](../prd.md): user stories 11–13, 27–30, 36, 40.

## What to build

Make the UI recover without a page reload, and make the mock able to break things on demand so this can be tested.

- Sync module: detect a `seq` gap and refetch the snapshot; on websocket reconnect refetch the snapshot; on `sim.reset` refetch the snapshot. During any refetch, buffer incoming messages and apply the contract rule (drop `seq <=` snapshot `seq`, apply the rest in order). Expose a connection status of `connected`, `resyncing` or `disconnected`. Reconnect with backoff.
- Mock server: a way to make the next message skip a `seq` number, a way to drop the websocket connection, and `POST /api/sim/reset` returning the `Run` and emitting `sim.reset`. These controls are reachable from the command line and, for convenience, from a small dev-only panel or endpoints.
- UI: a connection indicator showing the status; a "Reset scenario" control calling `POST /api/sim/reset`.
- A resync must not cause flicker, duplicated Vehicles, or a Vehicle snapping to a stale position.

## Acceptance criteria

- [ ] Forcing a `seq` gap on the mock makes the indicator show `resyncing` briefly and the map return to the correct live state with one Vehicle and no jump.
- [ ] Dropping the websocket makes the indicator show `disconnected`, then the client reconnects, resyncs and shows `connected` again, with no reload.
- [ ] `sim.reset` clears the Vehicle and returns the app to the starting state; spawning a flight works again afterwards.
- [ ] Sync tests (fake transport) cover: gap triggers refetch, reconnect triggers refetch, `sim.reset` triggers refetch, messages buffered during refetch handled per the rule, no duplicate or lost Vehicle after resync, repeated gaps during a resync do not loop or leak.
- [ ] The Level 0 definition of done from the PRD passes by hand: dot taxis RX1 to G1, forced gap resyncs cleanly.

## Blocked by

- 03-spawn-flight-live-taxi (`04-smooth-vehicle-motion` recommended first so smoothness during resync can be judged, but it is not required)
