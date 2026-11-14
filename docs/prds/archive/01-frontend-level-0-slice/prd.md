# Frontend (Tower): thin Level 0 slice

Status: ready-for-agent

## Problem Statement

Tower (the frontend) and Brain (the backend) are built in parallel and meet only at the contract in `docs/contract/`. Brain's real server does not exist yet, so Tower has nothing to run against. Without a working UI shell, a map, and a client that handles live state correctly, Tower cannot show Level 0 ("an aircraft taxis live") and cannot discover problems in the contract's websocket rules until Brain's server arrives.

The riskiest part of the UI is not drawing the map. It is staying correct while live state arrives: websocket messages can race the initial snapshot, `seq` can gap, and the socket can reconnect. If this is not tested early, it will be debugged late, against a backend that is also unfinished.

## Solution

Scaffold the frontend as a thin, end-to-end Level 0 vertical slice, plus a scripted-playback mock server that stands in for Brain's server.

From the user's perspective: they run the mock and the dev server, open the page, and see the airport drawn from the graph. A **Vehicle** (aircraft AC101) is spawned at Gate 1 and taxis from runway exit RX1 to G1 along the taxiway graph, moving smoothly between 500 ms updates and turning to face its direction of travel. A control on the mock can force a `seq` gap, and the UI visibly recovers by refetching the snapshot and resuming, without a stale or duplicated state.

The rest of the screens (event feed, approval queue, halt, ledger, zone drawing) exist as labelled placeholders so the layout is settled, and are filled in at Levels 1 and 2.

Rendering is plain SVG driven by one `requestAnimationFrame` loop. No canvas or animation library (PixiJS, Konva, GSAP) is used. The seed has 14 nodes, 17 edges and one vehicle, Level 3 targets three to five vehicles, and the plan's cut list already says to draw the airport as SVG from the graph.

## User Stories

1. As a Tower developer, I want a Vite, React and TypeScript app that starts with one command, so that I can begin building screens immediately.
2. As a Tower developer, I want the contract types imported directly from the contract folder through an `@contract` alias, so that a contract change shows up as a type error instead of silent drift.
3. As a Tower developer, I want the API base URL set by `VITE_API_URL`, so that switching from the mock to Brain's real server is a one-line change.
4. As a Tower developer, I want the websocket URL derived from the same base URL, so that I don't configure two addresses.
5. As a Tower developer, I want a mock server that serves `GET /api/graph` and `GET /api/state` from the seed, so that the map can be built before the backend exists.
6. As a Tower developer, I want the mock to speak the real websocket envelope (`type`, `seq`, `ts`, `data`) with `seq` increasing by exactly one per message, so that the client I write works against the real server unchanged.
7. As a Tower developer, I want the mock's snapshot to carry the current `seq`, so that I can test the buffer-and-drop resync rule.
8. As a Tower developer, I want `POST /api/flights` on the mock to spawn a Vehicle and emit `vehicle.spawned`, so that I can start the Level 0 scenario from the UI.
9. As a Tower developer, I want the mock to walk the spawned Vehicle along the edges from RX1 to its gate every 500 ms, emitting `vehicle.moved` with updated position, heading, route and status, so that I can test live movement.
10. As a Tower developer, I want the mock to emit the Vehicle's status changes (`idle`, `moving`) with its moves, so that the UI reflects status correctly.
11. As a Tower developer, I want a way to make the mock skip a `seq` number on demand, so that I can test gap detection without a flaky network.
12. As a Tower developer, I want a way to make the mock drop the websocket connection on demand, so that I can test reconnect and resync.
13. As a Tower developer, I want the mock to implement `POST /api/sim/reset` and emit `sim.reset`, so that I can restart the scenario and test the refetch path.
14. As a Tower developer, I want the mock to be easy to extend to Levels 1 and 2 (zones, `needs_approval`, halt), so that I can keep testing while Brain's server is built.
15. As a Tower developer, I want the mock to be clearly separate from the app code, so that it can be deleted when the real backend is live.
16. As a user, I want to see the airport drawn from the graph, with nodes, taxiway and apron edges, runway edges, and the runway crossing, so that I understand the layout.
17. As a user, I want gates, junctions and runway exits to be visually distinguishable and labelled, so that I can read the map.
18. As a user, I want the map scaled so that distances look correct at the airport's latitude, so that the layout isn't stretched.
19. As a user, I want north to be up on the map, so that heading values match what I see.
20. As a user, I want to see each Vehicle drawn at its position, so that I know where it is.
21. As a user, I want a Vehicle to move smoothly rather than jump every 500 ms, so that the motion looks live.
22. As a user, I want a Vehicle to face its direction of travel, and to turn the short way round when heading crosses 0/360, so that it doesn't spin the wrong way.
23. As a user, I want a stationary Vehicle to keep its last heading, so that it doesn't snap to north.
24. As a user, I want a Vehicle's planned route highlighted on the map, so that I can see where it is going.
25. As a user, I want the route highlight to update when a Vehicle's `route` changes, so that reroutes are visible at once.
26. As a user, I want to start the Level 0 scenario by spawning a flight at a chosen gate, so that I can demo it on demand.
27. As a user, I want to reset the scenario, so that I can run the demo again from a clean state.
28. As a user, I want a visible connection indicator (connected, resyncing, disconnected), so that I know whether the map is live.
29. As a user, I want the map to recover on its own after a dropped message or a reconnect, so that I never have to reload the page.
30. As a user, I want no flicker, duplicated Vehicles or stale positions during a resync, so that recovery looks seamless.
31. As a user, I want a layout with the map as the main area and labelled panels for the event feed, approval queue, ledger, run controls and zone drawing, so that the screen structure is settled early.
32. As a user, I want placeholder panels to say which level fills them in, so that empty areas don't look broken.
33. As a user, I want a run-status area showing whether the run is `running` or `halted`, so that the kill-switch state has a place on screen.
34. As a user, I want the map to keep working when the window is resized, so that I can present on any screen.
35. As a Tower developer, I want applying a websocket message to state to be a pure function, so that I can test every message type without a browser.
36. As a Tower developer, I want the resync rules (buffer while the snapshot loads, drop `seq <=` snapshot `seq`, apply the rest in order, refetch on a gap) in one module with a small interface, so that they are tested in isolation and not scattered through components.
37. As a Tower developer, I want the projection from `[lon, lat]` to SVG coordinates and its inverse in one module, so that map drawing and (later) zone drawing share one tested transform.
38. As a Tower developer, I want Vehicle positions kept out of React state and written to the DOM from the animation loop, so that the UI does not re-render 60 times a second.
39. As a Tower developer, I want the non-moving state (zones, approvals, run status, connection status) in normal React state, so that panels are ordinary components.
40. As a Brain developer, I want the mock's behaviour to match `api.md`, so that if the mock and the contract disagree I can see which is wrong.
41. As a Brain developer, I want the UI to treat my server only through the contract, so that I can change the backend freely.
42. As a team member, I want the docs-only contract fix applied (the "Snapshot carries `seq`" decision moved out of *Deferred* in the contract README), so that the contract no longer contradicts itself.

## Implementation Decisions

**Stack**
- Vite, React and TypeScript. State is held in a small store (a reducer; Zustand is optional and may be added if it simplifies things).
- The map is plain SVG. There is one `requestAnimationFrame` loop. PixiJS, Konva and GSAP are not used and no skills for them are installed. Moving to a canvas library later would replace only the map component; the client, store and panels would not change.
- The contract is imported through an `@contract` path alias pointing at the contract folder (types and `seed.json`). There are no npm workspaces and no root `package.json`. Brain may use the same alias approach.
- `VITE_API_URL` is the single base address. The websocket address is derived from it. The Vite dev server proxy is allowed as a convenience but is not required.

**Modules** (deep modules are marked; these should have small, stable interfaces and be testable without a browser)
- **Projection (deep).** Pure functions that map `[lon, lat]` to SVG coordinates and back, given the graph's `bounds`. Linear projection onto the viewBox, y flipped (north up), longitude scaled by `cos(lat)` using the bounds' centre latitude. The inverse is used later to turn drawn zones into `[lon, lat]`.
- **Snapshot-and-stream sync (deep).** Owns the contract's client rules: buffer messages while the snapshot loads; apply the snapshot; drop buffered messages with `seq <=` snapshot `seq`; apply the rest in order; refetch on a `seq` gap, on reconnect, and on `sim.reset`. Exposes a connection status (connected, resyncing, disconnected). It receives a transport (fetch and websocket) so it can be driven by a fake in tests.
- **State reducer (deep).** A pure function from (state, `WsMessage`) to state, and from (state, `Snapshot`) to state. Covers every message type in `types.ts`: vehicle spawned and moved, zone created, expired and removed, action decided, approval requested and resolved, run halted and resumed, ledger appended. Replacing a vehicle by `_id` is idempotent. Unknown or not-yet-used message types must not throw.
- **Vehicle motion (deep).** Pure functions that, given a vehicle's previous and latest positions and headings and the time since the update, return the eased position and heading. Heading takes the shortest arc across 0/360. It eases over about one tick (default 500 ms) and clamps at the target if no new update arrives. The animation loop calls this and writes `transform` on vehicle elements by ref; React state is not touched per frame.
- **API client.** Thin typed wrappers for the REST endpoints in `api.md` and the websocket connection. Level 0 uses graph, state, start, reset and spawn flight; the rest are typed but may be unused.
- **Map component.** Draws the static base layer (edges by kind, nodes by type, labels) once from the graph; draws vehicles and the route highlight as a dynamic layer. The route highlight is derived from `vehicle.route` and the graph's edge geometry. Vehicle sprites are chosen by `kind` (a UI-only mapping).
- **Layout and placeholder panels.** App shell with the map as the main area and labelled placeholders for event feed, approval queue, ledger, run controls (halt and resume) and zone drawing, plus a connection indicator and run status. Placeholders state which level fills them in.
- **Mock server (separate, disposable).** A small Node and TypeScript server using the shared contract types. It serves the graph and state from the seed, a websocket that follows the real envelope, and the endpoints needed for Level 0 (start, reset, spawn flight). It plays back a scripted taxi from RX1 to the requested gate along the graph at a 500 ms tick. It can, on demand, skip a `seq` number and drop the websocket connection. It must be structured so Level 1 (zones, reroute) and Level 2 (`needs_approval`, resolve, halt, resume, red-team) can be added later.

**Behaviour**
- On load the client fetches the graph, then runs the snapshot-and-stream sync. The map renders once the graph and snapshot are available.
- Vehicle `ts` is the time of the server write and is used to schedule easing.
- A `vehicle.moved` replaces the vehicle's document, including `route`, `heading` and `status`; the UI never infers status from movement.
- A halted run shows halted state from `run.halted`; full halt behaviour is a later level.

**Contract**
- The contract is not changed, except for a docs-only fix: the "Snapshot carries `seq`" bullet is listed under *Deferred* in the contract README even though it is already in `types.ts` and `api.md` and the resync rules depend on it. It moves to *Decisions so far*. Brain is told, because it is a contract file. This fix lands as its own commit before the scaffold.
- The mock follows `api.md` exactly. Any difference found while building is raised as a contract question, not worked around silently.

## Testing Decisions

- A good test checks external behaviour through the module's public interface: given inputs, assert outputs. It does not assert on internal state, call order or component structure.
- **Tested, with unit tests:** Projection (round trip, y flip, `cos(lat)` scaling, bounds corners map to viewBox corners); State reducer (each message type, idempotent replacement, snapshot replacement); Snapshot-and-stream sync (using a fake transport: messages arriving before the snapshot, buffered messages with `seq <=` snapshot `seq` dropped, `seq` gap triggers refetch, reconnect triggers refetch, `sim.reset` triggers refetch, no duplicate or lost vehicle after resync); Vehicle motion (midpoint, clamping at the target, shortest-arc heading across 0/360 in both directions, stationary vehicle keeps heading).
- **Not unit tested:** the Map component's drawing, placeholder panels, and the API client wrappers. They are checked by running the app.
- **End-to-end check by hand (the definition of done):** run the mock and the dev server; spawn a flight; the dot taxis from RX1 to G1 smoothly; force a `seq` gap on the mock and watch the UI resync with no duplicates or jumps; drop the websocket and watch it reconnect and resync.
- There is no prior art in the repo (it has no frontend code yet). Use Vitest, which fits Vite.

## Out of Scope

- Levels 1 to 4 behaviour in the UI: zone drawing, closure countdown, approval queue contents, ledger view and replay scrubber, halt button behaviour, denied-action alert, the under-the-hood panel. Only their placeholders are in scope.
- Real map tiles, physics, collisions, wind, more than one airport, login and auth, mobile layout (per the plan's cut list).
- Any canvas or animation library.
- Multiple Vehicles and Vehicle kinds other than aircraft (Level 3).
- The real backend, Atlas, change streams and the controller agent (Brain's work).
- npm workspaces or any root-level tooling.
- Changes to the contract other than the docs-only `seq` fix.

## Further Notes

- Terms follow `/CONTEXT.md`: the moving thing is a **Vehicle**; "aircraft" is only one kind.
- Decision record from the planning session: plain SVG over PixiJS or Konva, because the contract's scale (about 14 nodes, 1 to 5 vehicles, 500 ms updates) is far below where canvas libraries pay off. This is easy to reverse, so no ADR was written.
- Open question for Level 1, not needed now: the click-to-drop zone polygon's size in metres should match the closure icon's footprint; keep it as a single UI constant.
- The mock and Brain's server will both be fed by the contract. If Brain's server is ready sooner, switch `VITE_API_URL` and keep the mock only for forcing failure cases.

## Issues

Under `issues/`, in build order:

1. `01-contract-readme-snapshot-seq.md`
2. `02-airport-map-from-mock-graph.md`
3. `03-spawn-flight-live-taxi.md`
4. `04-smooth-vehicle-motion.md`
5. `05-resync-on-gap-reconnect-reset.md`
6. `06-layout-placeholder-panels-run-status.md`
