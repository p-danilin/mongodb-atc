# 02. Drop, see and remove closures

Type: AFK · Labels: ready-for-agent

## Parent

[`../prd.md`](../prd.md): user stories 1–15.

## What to build

Level 1 end to end: a person drops a closure on the map, vehicles reroute (Brain does that), and the closure counts down and can be removed.

- API client: typed calls to create and delete a closure; Brain's error message is surfaced.
- A pure **closure geometry** module: builds the fixed 50 m-radius octagon around a click point as a closed GeoJSON polygon using the inverse projection; formats the countdown from `expires_at` (minutes and seconds, never negative after expiry); finds the nearest edge name to build the reason ("Closure on Taxiway A").
- UI-only state: drop mode on or off, the chosen TTL, and the selected closure.
- Map: a **Drop closure** toggle at the top-left (off by default); crosshair cursor in drop mode; each click creates one closure; Escape or a second click on the toggle exits. A TTL select (30 s, 1 min, 5 min, default 1 min) sits beside it. No modal and no typed reason.
- Closure layer, drawn above the taxiways and below the vehicles: red translucent hatch, dashed outline, label "Closure · 0:42" counting down from the server's `expires_at`. Clicking a closure selects it and shows a remove button that deletes it. The UI never schedules its own deletion: a closure leaves the map on `zone.expired` or `zone.removed`.
- A rejected polygon (`400`) shows as an inline message, like the spawn errors.
- Closures stay droppable while the run is halted.
- Replace the Closures placeholder card in the side panel with the controls' help text.

## Acceptance criteria

- [ ] With drop mode on, a click creates a closure; with it off, clicks create nothing. Escape and a second click on the toggle both leave drop mode.
- [ ] The closure shows a countdown that matches `expires_at`, and disappears when the server expires it.
- [ ] Dropping a closure on a vehicle's route makes the vehicle's blue route change (Brain's replan arrives as `vehicle.moved`).
- [ ] Selecting a closure and pressing remove deletes it and it leaves the map.
- [ ] A closure outside the airport's bounds shows an inline error and no closure appears.
- [ ] Unit tests (pure modules only): the octagon is a closed ring with about a 50 m radius and round-trips through the inverse projection; countdown formatting including a past `expires_at`; nearest-edge name; reducer cases for closures created, expired and removed.

## Blocked by

None - can start immediately
