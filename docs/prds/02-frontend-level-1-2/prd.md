# Frontend (Tower): Levels 1 and 2

Status: ready-for-agent

## Problem Statement

Brain (the backend) now implements the whole contract through Level 2: closures with replanning, the policy gate, approvals, halt and resume, the red-team endpoint and the ledger. Tower (the frontend) still shows only Level 0. A person can spawn a flight and watch it taxi, but cannot drop a closure, see a decision, answer an approval, stop the run, or read the record. The panels for all of these are labelled placeholders.

That leaves the product's whole point invisible. The pitch is that every move is checked before it happens and recorded after, so a reviewer can replay the run. Without Tower showing the checks and the record, the demo has nothing to show for Levels 1 and 2, even though Brain already does the work.

Two smaller problems get in the way. The mock server cannot be extended to closures, the policy gate and approvals without copying Brain's rules into a second place. And the word "gate" means both an airport stand and the policy check, which makes on-screen copy ambiguous.

## Solution

Fill in the Level 1 and Level 2 screens against the real Brain, using the contract only.

From the user's point of view: they switch on **Drop closure**, click the map, and a closure appears with a countdown; vehicles whose routes it touches are replanned. When a route needs a human decision, the vehicle stops with an amber ring, its proposed route is drawn as a dashed amber line, and a row appears in the approval queue showing who, where, why and which policy. They approve or deny, and the decision shows up in the feed. A single header button halts the whole run and resumes it. A **Red team** button asks the controller to propose a route through a closure; the policy gate denies it and Tower shows a persistent alert naming the policy and the record. One feed, backed by the ledger, shows what happened, in order, live and as a filterable history for the current run.

Normal denials stay quiet (a red feed row and a short flash on the vehicle); only the red-team denial raises an alert, because a person asked for it. Nothing in the UI invents state: pending approvals, run status and the ledger all come from Brain.

Rendering stays plain SVG with the single animation loop. The mock server is deleted and Tower defaults to Brain's port.

## User Stories

**Closures**
1. As a supervisor, I want a **Drop closure** toggle on the map, so that I can close part of the airport without any accidental clicks.
2. As a supervisor, I want the toggle off by default, so that ordinary clicks on the map never create a closure.
3. As a supervisor, I want a crosshair cursor while the toggle is on, so that I can tell the map is in drop mode.
4. As a supervisor, I want Escape or a second click on the toggle to leave drop mode, so that I can get out without dropping anything.
5. As a supervisor, I want a click to drop a closure of a fixed, small size, so that one click closes about one stretch of taxiway and not its neighbours.
6. As a supervisor, I want to pick how long a closure lasts (30 seconds, 1 minute or 5 minutes, default 1 minute), so that I can match the demo's pace.
7. As a supervisor, I want a closure's reason written for me from the nearest taxiway name (for example "Closure on Taxiway A"), so that I never face a form in the middle of a demo.
8. As a supervisor, I want each closure drawn as a clearly marked red area, so that I can see at once where vehicles may not go.
9. As a supervisor, I want a closure to show a countdown to its expiry, so that I know when the airport reopens.
10. As a supervisor, I want the countdown to read from the server's expiry time, so that it matches when the closure really ends.
11. As a supervisor, I want a closure to disappear when the server says it has expired, so that the map never shows a closure that is no longer in force.
12. As a supervisor, I want to click a closure to select it, and remove it with a button, so that I can reopen the airport early.
13. As a supervisor, I want a rejected closure (for example outside the airport) to show an inline message, so that I know why nothing appeared.
14. As a supervisor, I want to see a vehicle's route change when a closure forces a reroute, so that I can follow what the controller did.
15. As a supervisor, I want closures to stay droppable while the run is halted, so that I can close an area and then resume.

**Approvals**
16. As a supervisor, I want a queue of routes waiting for my decision, so that I can answer them one at a time.
17. As a supervisor, I want each row to say which flight is going to which gate, so that I know what I am approving.
18. As a supervisor, I want each row to show the reason the policy gate gave and the policy ids behind it, so that I understand why a human is needed.
19. As a supervisor, I want to approve or deny with an optional note, so that my decision is recorded with a reason.
20. As a supervisor, I want the buttons to disable while my answer is in flight, so that I cannot answer twice.
21. As a supervisor, I want a row to leave the queue when the server confirms the resolution, so that the queue always matches what Brain says is pending.
22. As a supervisor, I want a clear inline message when an answer is refused (already resolved, or the run is halted), so that I understand what happened.
23. As a supervisor, I want the newest request on top, so that the one I am most likely looking at on the map is the first row.
24. As a supervisor, I want a dashed amber line on the map for every pending proposed route, so that I can see where the vehicle wants to go before I approve.
25. As a supervisor, I want hovering or focusing a row to thicken and brighten that route, so that I can tell which line belongs to which row.
26. As a supervisor, I want a vehicle waiting for approval to carry a pulsing amber ring, so that a stopped vehicle is visible on the map without opening the queue.
27. As a supervisor, I want the Approvals tab to show a count, and the count to pulse once when it goes up, so that a new request catches my eye.
28. As a supervisor, I want a "1 approval waiting" chip in the header that opens the Approvals tab, so that I can get there even when the side panel is scrolled.
29. As a supervisor, I want the tabs never to switch on their own, so that a new approval does not pull me away from what I am reading.
30. As a supervisor, I want an approved route that the policy gate rechecks and refuses to appear as a new decision in the feed, so that I am not told the vehicle is moving when it is not.

**Halt and resume**
31. As a supervisor, I want one button in the header that halts the run, so that I can stop everything in one click.
32. As a supervisor, I want that button to become **Resume** while the run is halted, so that there is always exactly one obvious action.
33. As a supervisor, I want no confirmation dialog on halt, so that the kill switch is as fast as it can be.
34. As a supervisor, I want a full-width red banner over the map saying who halted the run and when, so that nobody mistakes a frozen airport for a fault.
35. As a supervisor, I want halted vehicles drawn greyed and still, so that the frozen state is visible on the map.
36. As a supervisor, I want **Spawn flight** and **Approve** and **Deny** disabled while halted, with a tooltip saying to resume first, so that I never hit a refusal I could have been warned about.
37. As a supervisor, I want pending approvals to stay in the queue while halted, so that I can answer them once I resume.
38. As a supervisor, I want **Reset** to work while halted, so that I can always start again from a clean run.

**Denials and the red team**
39. As a reviewer, I want every denied route to show as a red row in the feed with its policy id, so that denials are visible without being noisy.
40. As a reviewer, I want a denied vehicle to flash red briefly on the map, so that I can see which vehicle was refused.
41. As a presenter, I want a **Red team** button that asks the controller for a route through a closure, so that I can show the policy gate refusing it.
42. As a presenter, I want the button disabled, with an explanation, until there is at least one closure and one vehicle, so that I am not sent to an error.
43. As a presenter, I want a persistent alert after a red-team denial naming the policy, the reason and the record id, so that the proof of the check stays on screen.
44. As a presenter, I want that alert to link to the matching row in the feed and highlight it, so that I can show the record the decision left behind.
45. As a presenter, I want the alert to stay until I dismiss it, so that I control the pace of the demo.
46. As a presenter, I want the red-team button to stay enabled while halted, so that I can show the run-halted policy refusing a route too.
47. As a reviewer, I want routine denials never to raise the red-team alert, so that the alert always means "a person asked for this refusal".

**The feed and the ledger**
48. As a reviewer, I want one feed built from the ledger, so that what I see live and what I read back later are the same record.
49. As a reviewer, I want the Events tab to show the latest entries of the current run as they arrive, so that I can follow the run live.
50. As a reviewer, I want the Ledger tab to show every entry of the current run in order, so that I can read the whole run.
51. As a reviewer, I want filter chips for decisions, closures and run control, so that I can narrow the ledger to what I am checking.
52. As a reviewer, I want each row to show the time, the actor, a coloured event chip and the one-line summary, so that I can scan it quickly.
53. As a reviewer, I want the feed to clear and load the new run when the scenario is reset, so that I never see a mix of two runs.
54. As a reviewer, I want the feed to reload and drop duplicates after a reconnect, so that a dropped connection leaves no gaps and no repeats.
55. As a reviewer, I want entries ordered by their ledger number, so that the order is the one Brain recorded.

**Screen and setup**
56. As a team member, I want the words **Gate** and **Policy gate** used consistently on screen, so that "gate" never means two things in one sentence.
57. As a team member, I want Tower to talk to Brain on its own port by default, so that `npm run dev` works against a local Brain with no flags.
58. As a team member, I want the mock server gone, so that there is one set of rules and nothing to drift.
59. As a new developer, I want the README to tell me to re-run the seed after pulling Brain changes, so that I am not confused when the policy gate seems to allow everything.
60. As a team member, I want one scripted end-to-end check against a local Brain, so that I can confirm Levels 1 and 2 work together in one command.

## Implementation Decisions

**Already built (do not redo; later issues build on it)**
- **Approval queue row.** Shows "AC101 → Gate 5", the gate's reason, the policy id badges, an optional note, Approve and Deny. The list comes from the snapshot's pending approvals plus `approval.requested` and `approval.resolved`; a row leaves on the resolved message, not the HTTP response. Buttons disable in flight; a `409` shows inline. The API client has a resolve call that takes the action id.
- **Pending routes on the map.** A dashed amber line per pending action, from the action's proposed edges, using a new `--map-pending` colour; hovering or focusing a row thickens it. Edge direction for any route (blue or amber) comes from one pure helper.
- **Mock deleted; default API URL is Brain's port (4100).** The mock's `ws`, `tsx` and type packages are gone. The README describes restarting Brain to check reconnect.
- **Glossary** in `CONTEXT.md`: **Gate**, **Policy gate**, **Closure**, **Approval**.

**Modules** (deep modules are marked: small interface, pure, testable without a browser)
- **Ledger feed (deep).** Holds the current run's entries. Inputs: an initial fetch of the current run's ledger, each `ledger.appended` message, a "new run" signal and a "reload" signal. Output: the ordered, deduplicated list (by `n`) and, given a filter, the filtered list. Reset clears it; reload replaces it and dedupes. It never reads other websocket messages.
- **Closure geometry (deep).** Builds the fixed 50 m-radius octagon around a click as a closed GeoJSON polygon, using the inverse projection. Also formats a countdown from `expires_at` (minutes and seconds, never negative past expiry) and picks the nearest edge name for the auto-generated reason.
- **Derived controls (deep).** Small pure functions: whether **Spawn flight** is enabled, whether **Approve** and **Deny** are enabled, whether **Red team** is enabled and why not, and the header chip's text. Inputs are the store's run status, vehicles, closures and pending approvals.
- **State reducer (modify).** Keeps pending approvals newest first. Everything else for Levels 1 and 2 already works; tests cover it.
- **UI store (modify).** Holds UI-only state: the highlighted approval (already present), the current red-team alert, drop-mode, the selected closure and the selected tab (needed for the header chip). None of this is sent to or read from Brain.
- **API client (modify).** Typed calls for create and delete closure, halt, resume, red team and the ledger fetch, with Brain's error message surfaced.
- **Map (modify).** New layers: closure polygons (red translucent hatch, dashed outline, "Closure · 0:42" label) above the taxiways and below the vehicles; drop-mode click handling and cursor; the existing amber pending routes. Vehicle sprites gain a pulsing amber ring for `awaiting_approval`, grey for `halted`, and a one-off red flash of about one second on any `deny`.
- **Animation loop (modify).** The flash and pulse are drawn by the same loop as the motion and written to the DOM by reference. React does not re-render per frame.
- **Header and panels (modify).** Halt and Resume as one toggle; Red team button; the "approvals waiting" chip; Approvals tab count that pulses once when it rises; the halt banner over the map; the red-team alert card.

**Behaviour decisions**
- **One feed, from the ledger.** Events is the live tail (about the last 20); Ledger is the full list for the current run with client-side filter chips (decisions, closures, run control). One component, two presentations. Rows are the summary line with time, actor and a coloured event chip. There is no expand-to-detail, because the contract has no way to fetch an action. The denied-vehicle flash fires from `action.decided`, never from the feed, so the flash does not wait on ledger-write latency.
- **Current run only.** No run picker.
- **Closure drop.** Toggle at the map's top-left; off by default; crosshair; Escape or a second click exits; fixed 50 m octagon; TTL select 30 s, 1 min, 5 min with 1 min default; the reason is generated, never typed; no modal. Clicking a closure selects it and shows a remove button that deletes it. The countdown reads from `expires_at`; the server removes the closure at expiry and the UI never schedules its own deletion. A rejected polygon shows as an inline message like the spawn errors.
- **Edges a closure blocks are not recoloured**; the polygon already shows where it is. Reroutes get no special animation; the new route simply replaces the old one and the feed says it was rerouted.
- **Halt.** One header toggle driven by the run status from the snapshot and the `run.halted` and `run.resumed` messages. No confirmation, no reason field. A red banner over the map reads "Run halted by supervisor-1 at 14:02:31" from `halted_by` and `halted_at`. While halted, Spawn flight and Approve and Deny are disabled with the tooltip "Resume the run first"; pending approvals stay; closures stay droppable (Brain accepts them and replans on resume); Reset is allowed.
- **Denials are quiet.** Every denial is a red feed row with its policy id plus the vehicle flash. Only the red-team denial raises the persistent alert. The alert is built from the `Action` returned by the red-team call, not by matching text in the ledger. It reads "Denied by <policy>: <reason>", "Recorded as <action id>", and has a **Show in feed** link that scrolls to and highlights the ledger row; it stays until dismissed.
- **Red team.** The button sits beside Halt and is disabled with the tooltip "Drop a closure and spawn a flight first" until there is at least one closure and one vehicle. It stays enabled while halted, where the denial is for the run being halted.
- **Noticing approvals.** No automatic tab switching. The Approvals tab shows a count that pulses once when it rises; an awaiting vehicle has the pulsing ring; a header chip such as "1 approval waiting" selects the Approvals tab on click. The queue lists newest first.
- **Words on screen.** "Gate" is only the airport stand. The policy check is never called "the gate"; the UI names the policy id instead.
- **Contract.** No changes. Follow-up asks to Brain, not needed here: `policy_ids` and `reason` on ledger entries, and a `GET /api/runs` list.
- **Setup.** Brain must be seeded again after pulling Brain changes, or its policies are missing and the policy gate allows everything. The README says so.

## Testing Decisions

- A good test checks behaviour through a module's public interface: given inputs, assert outputs. It does not look at internal state, call order or component structure. Keep it to the basics.
- **Unit tests, pure modules only:**
  - Reducer: zones created, expired and removed; approvals requested and resolved, newest first; `run.halted` and `run.resumed`.
  - Ledger feed: merge the initial fetch with appended entries, dedupe on `n`, ordering, filters, reset clears, reload replaces and dedupes.
  - Closure geometry: the octagon is a closed ring with about a 50 m radius and round-trips through the inverse projection; countdown formatting including past expiry.
  - Derived controls: Spawn, Approve and Deny, and Red team enablement, and the chip text.
- **No component or browser tests.** Rendering is checked by eye and against the real Brain.
- **One end-to-end script** in the repo that runs against a local Brain: spawn a flight at Gate 5, resolve the approval, drop a closure, halt, resume, then assert on the ledger. It is the definition of done for the PRD.
- **Prior art:** Vitest with pure-module tests already in place for the projection, motion, sync, reducer, approval-row and route-geometry modules; the sync tests use a fake transport.

## Out of Scope

- Level 3 (several vehicle kinds, hold-short conflicts), the replay scrubber, voice and the LLM controller.
- A run picker or any view of earlier runs (needs `GET /api/runs`).
- Policy detail (policy ids and reasons) in ledger history; needs a Brain change.
- The "under-the-hood" panel showing the validator rejecting a write.
- Vehicle emphasis when hovering a queue row (only the route is emphasised).
- Recolouring blocked edges, and animations for reroutes.
- Sound or browser notifications.
- Component or browser tests.
- Real map tiles, mobile layout, auth and multiple airports (the plan's cut list).
- Contract changes.

## Further Notes

- Terms follow `/CONTEXT.md`. The new entries (Gate, Policy gate, Closure, Approval) were agreed in the grilling session; use them in code comments, copy and issues.
- Brain's behaviour is documented in `backend/README.md`. Local data comes from the Docker Compose MongoDB at the repo root; give each developer their own database when using a shared Atlas cluster, because two Brains on one database move each other's vehicles.
- The Level 0 PRD's story to extend the mock to Levels 1 and 2 is dropped: Brain implements those levels, and a second copy of its rules would drift.
- Decision record: one feed backed by the ledger was chosen so the live view and the audit record cannot disagree. It is cheap to change, so no ADR was written.

## Issues

Under `issues/`, in build order (see each file's "Blocked by"):

1. `01-ledger-feed-events-and-ledger-tabs.md`
2. `02-drop-and-remove-closures.md`
3. `03-halt-and-resume.md`
4. `04-vehicle-states-and-denial-flash.md`
5. `05-approval-queue-newest-first-and-attention.md`
6. `06-red-team-button-and-alert.md`
7. `07-end-to-end-check-and-setup-docs.md`
