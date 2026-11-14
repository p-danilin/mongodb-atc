# 06. Screen layout with placeholder panels and run status

Type: AFK · Labels: ready-for-agent

## Parent

[`../prd.md`](../prd.md): user stories 31–33, 39.

## What to build

Settle the screen structure so Levels 1 and 2 only fill in panels.

- Layout with the map as the main area and labelled placeholder panels for: event feed, approval queue, ledger, run controls (halt and resume), and zone drawing. Each placeholder says which level fills it in.
- A run-status area showing `running` or `halted`, driven by the store: the snapshot's `run` and the `run.halted` and `run.resumed` messages. Halt and resume buttons are present but disabled, marked as a Level 2 feature.
- The connection indicator (from `05-resync-on-gap-reconnect-reset`, or a stub if that is not done) sits in the shell.
- Ordinary React components reading non-moving state from the store; no per-frame re-renders.

## Acceptance criteria

- [ ] All five placeholder panels are visible with their level labels, and the map remains the primary area at common laptop sizes.
- [ ] The run status reads `running` from the seed snapshot.
- [ ] A `run.halted` message from the mock flips the status to `halted` and `run.resumed` flips it back (a reducer test covers this; a dev control or manual websocket message can trigger it by hand).
- [ ] Halt and resume are visibly disabled and explain why.
- [ ] No placeholder looks like a broken or empty component.

## Blocked by

- 03-spawn-flight-live-taxi
