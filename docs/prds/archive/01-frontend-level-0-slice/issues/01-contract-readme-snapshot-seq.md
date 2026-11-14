# 01. Fix the contract README (snapshot `seq` is a decision, not deferred)

Type: AFK · Labels: ready-for-agent

## Parent

[`../prd.md`](../prd.md): user story 42.

## What to build

Docs-only change. In the contract README, the bullet "Snapshot carries `seq`" sits under *Deferred (not in the frozen contract)*. It is already in the contract's types and API doc, and the client resync rules depend on it. Move it into *Decisions so far* so the contract no longer contradicts itself. Change no wording of the rule itself.

This is a contract file, so the commit message and PR description should say Brain needs to be told. Commit it on its own, before any scaffold work.

## Acceptance criteria

- [ ] The bullet appears under *Decisions so far* and no longer under *Deferred*.
- [ ] The *Deferred* section still contains the under-the-hood panel bullet.
- [ ] No other file in the contract folder changes.
- [ ] The commit is separate from all frontend work and notes that Brain should be informed.

## Blocked by

None - can start immediately
