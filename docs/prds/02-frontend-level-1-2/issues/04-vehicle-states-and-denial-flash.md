# 04. Vehicle states on the map and the denial flash

Type: AFK · Labels: ready-for-agent

## Parent

[`../prd.md`](../prd.md): user stories 26, 35, 40.

## What to build

Make each vehicle's state readable on the map without opening a panel.

- `awaiting_approval`: a pulsing amber ring around the vehicle (the same amber as the pending routes).
- `halted`: the vehicle is greyed and still.
- Any denial: a one-off red flash of about one second on the vehicle named in the action's payload, triggered by the `action.decided` message with decision `deny`. It does not wait for the ledger feed.
- The ring, the grey state and the flash are drawn by the same animation loop as the motion and written to the DOM by reference. React must not re-render per frame, and the loop sleeps when nothing animates.
- Reroutes get no special animation: the route simply changes.
- The legend lists the new states.

## Acceptance criteria

- [ ] A vehicle waiting on a runway-crossing approval shows a pulsing amber ring until it is answered.
- [ ] After a halt the vehicles are greyed; after a resume they return to normal.
- [ ] A denied route (for example a second flight to an occupied gate, or the red-team route) flashes the right vehicle once.
- [ ] No per-frame React re-renders (inspection or a render counter), and no flash for allow or needs-approval decisions.
- [ ] Unit tests only where there is pure logic (for example mapping a message to the vehicle to flash); no browser tests.

## Blocked by

None - can start immediately
