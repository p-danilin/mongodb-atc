# 05. Approval queue order and attention signals

Type: AFK · Labels: ready-for-agent

## Parent

[`../prd.md`](../prd.md): user stories 23, 27–30.

## What to build

The queue row, the amber routes and the tab count badge already exist. This slice makes new approvals easy to notice without ever stealing focus.

- The queue lists the newest request first. The reducer keeps pending approvals in that order (a new request goes on top; the snapshot's list is shown newest first too).
- The Approvals tab's count badge pulses once whenever the count goes up.
- A header chip such as "1 approval waiting" (text from a pure function; hidden at zero) selects the Approvals tab on click, even when the side panel is scrolled. This needs the selected tab held in UI state.
- Tabs never switch on their own.
- After an approve that Brain re-checks and refuses, the follow-up decision shows in the feed; the queue makes no promise that the vehicle moves (nothing extra to build beyond not claiming it).

## Acceptance criteria

- [ ] With two pending approvals, the newer one is the first row; the map still draws both amber routes and only the hovered one is thick.
- [ ] A new approval pulses the tab badge once and shows the header chip; clicking the chip opens the Approvals tab.
- [ ] No tab changes by itself when an approval arrives.
- [ ] Unit tests (pure modules only): reducer keeps pending approvals newest first for `approval.requested` and `approval.resolved`; chip text for zero, one and many.

## Blocked by

None - can start immediately
