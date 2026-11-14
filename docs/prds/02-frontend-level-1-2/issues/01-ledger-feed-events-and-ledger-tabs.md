# 01. One ledger-backed feed: Events and Ledger tabs

Type: AFK · Labels: ready-for-agent

## Parent

[`../prd.md`](../prd.md): user stories 39, 48–55.

## What to build

Replace the Events and Ledger placeholders with one feed built from the current run's ledger, so what a reviewer sees live and what they read back later are the same record.

- A pure **ledger feed** module holds the current run's entries. It takes the initial ledger fetch, each `ledger.appended` message, a "new run" signal and a "reload" signal. It returns the entries ordered and deduplicated by their ledger number `n`, and applies a filter on request. It never reads any other websocket message.
- API client: a typed call for the ledger of a run.
- On load, and on every resync (reconnect, `seq` gap), fetch the current run's ledger and reload the feed. On `sim.reset` (a new run id arrives with the refetched snapshot), clear the feed and load the new run's ledger.
- One feed component with two presentations: **Events** is the live tail (about the last 20, newest visible, no filters); **Ledger** is the full list for the current run with client-side filter chips (decisions, closures, run control).
- Each row shows the time, the actor, a coloured event chip and the one-line summary. A denied decision is a red row. There is no expand-to-detail (the contract has no action lookup).
- Use the glossary: the UI never calls the policy check "the gate"; row text comes from Brain's summary line as-is.

## Acceptance criteria

- [ ] Against a local Brain, spawning a flight and dropping a closure (by curl is fine) adds rows to the Events tab live, in ledger order.
- [ ] The Ledger tab lists every entry of the current run and the filter chips narrow it (decisions, closures, run control).
- [ ] A denied decision renders as a red row.
- [ ] After **Reset**, the feed is empty and shows only the new run's entries. After restarting Brain (reconnect), there are no duplicate or missing rows.
- [ ] Unit tests (pure module only): merge of the initial fetch with appended entries, dedupe on `n`, ordering, filters, reset clears, reload replaces and dedupes.
- [ ] The empty states say what will appear, not which level fills them in.

## Blocked by

None - can start immediately
