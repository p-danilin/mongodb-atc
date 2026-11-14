# 07. End-to-end check and setup docs

Type: AFK · Labels: ready-for-agent

## Parent

[`../prd.md`](../prd.md): user stories 57–60.

## What to build

One scripted check that Levels 1 and 2 work together against a real Brain, plus the setup notes that were missing.

- A script in the repo that, against a local Brain on the default port, runs: reset, spawn a flight at Gate 5 (expect needs-approval), resolve the approval, drop a closure on a vehicle's route (expect a reroute), halt (expect spawn to be refused), resume, then fetch the ledger and assert that the entries for each step are present, in order, with the expected events. It exits non-zero with a readable message on the first failure.
- Document how to run it in the frontend README and the root README.
- Root README and backend README: after pulling Brain changes, re-run the seed, or the policies are missing and the policy gate allows everything.
- Confirm the READMEs match what is built: no mock, default API URL is Brain's port, local MongoDB through Docker Compose.

## Acceptance criteria

- [ ] With the local database seeded and Brain running, the script passes and prints one line per step.
- [ ] Pointed at a database that was not re-seeded (no policies), the script fails with a message that mentions re-seeding.
- [ ] The READMEs describe how to run the script and the re-seed step.
- [ ] No component or browser tests are added.

## Blocked by

- 01-ledger-feed-events-and-ledger-tabs
- 02-drop-and-remove-closures
- 03-halt-and-resume
- 06-red-team-button-and-alert
