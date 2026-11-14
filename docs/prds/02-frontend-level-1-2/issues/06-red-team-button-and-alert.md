# 06. Red team button and the denial alert

Type: AFK · Labels: ready-for-agent

## Parent

[`../prd.md`](../prd.md): user stories 41–47.

## What to build

The demo's proof moment: ask the controller for a route through a closure, watch the policy gate refuse it, and keep the evidence on screen.

- API client: a typed call to the red-team endpoint, returning the `Action`.
- **Red team** button beside Halt. Its enablement and the reason it is disabled come from the derived controls module: disabled with the tooltip "Drop a closure and spawn a flight first" until there is at least one closure and one vehicle. It stays enabled while halted (the denial is then for the run being halted).
- A persistent alert card built from the returned `Action`, not from text in the ledger: "Denied by <policy id>: <reason>" and "Recorded as <action id>". It stays until dismissed.
- A **Show in feed** link on the card that opens the feed's Ledger view, scrolls to the matching entry and highlights it.
- Routine denials never raise this card: it appears only for the denial that the button itself requested.
- Use the glossary: the card names the policy id and never says "the gate".

## Acceptance criteria

- [ ] With no closure or no vehicle the button is disabled with the tooltip; with both, pressing it shows the alert card naming the policy and the action id.
- [ ] The card stays until dismissed; **Show in feed** highlights the matching ledger row.
- [ ] While the run is halted, the button works and the card shows the run-halted policy.
- [ ] A normal denial (for example an occupied gate) produces a red feed row and a flash, but no card.
- [ ] Unit tests (pure modules only): red-team enablement and its disabled reason, in running and halted states.

## Blocked by

- 01-ledger-feed-events-and-ledger-tabs
- 03-halt-and-resume
