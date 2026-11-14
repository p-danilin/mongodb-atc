# 03. Halt and resume the run

Type: AFK · Labels: ready-for-agent

## Parent

[`../prd.md`](../prd.md): user stories 31–38.

## What to build

Replace the disabled Halt and Resume placeholder with the working kill switch, and make the rest of the screen respect a halted run.

- API client: typed calls to halt and resume.
- A single header toggle driven by the run status (from the snapshot and the `run.halted` and `run.resumed` messages): red **Halt** while running, **Resume** while halted. No confirmation dialog, no reason field.
- A full-width red banner over the map while halted: "Run halted by supervisor-1 at 14:02:31", from `halted_by` and `halted_at`.
- A pure **derived controls** module (inputs: run status, vehicles, closures, pending approvals). In this slice it decides whether **Spawn flight** and **Approve** and **Deny** are enabled (disabled while halted). Disabled controls carry the tooltip "Resume the run first".
- Pending approvals stay in the queue while halted. **Reset** and closure drop stay enabled while halted.
- Brain's error message is surfaced if halt or resume is refused.

## Acceptance criteria

- [ ] Pressing Halt freezes the run; the button becomes Resume and the banner appears with the correct actor and time. Pressing Resume reverses it.
- [ ] While halted, Spawn flight, Approve and Deny are disabled with the tooltip; Reset and closure drop still work.
- [ ] A pending approval is still listed while halted and answerable after resume.
- [ ] Reloading the page while halted shows the halted state from the snapshot.
- [ ] Unit tests (pure modules only): reducer cases for `run.halted` and `run.resumed`; derived-controls enablement for Spawn, Approve and Deny in running and halted states.

## Blocked by

None - can start immediately
