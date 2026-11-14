# 04. Smooth Vehicle motion and heading

Type: AFK · Labels: ready-for-agent

## Parent

[`../prd.md`](../prd.md): user stories 21–23, 38.

## What to build

Replace jumpy movement with easing driven by a single `requestAnimationFrame` loop.

- A Vehicle motion module of pure functions: given a Vehicle's previous and latest position and heading and the time since the update, return the eased position and heading. Ease over about one tick (default 500 ms, a config value on the client). Clamp at the target if no newer update arrives. Heading takes the shortest arc across 0/360. A stationary Vehicle keeps its last heading. Unit tested.
- One animation loop that reads the motion module and writes the `transform` of each Vehicle's SVG element by ref. No per-frame React state updates.
- The Vehicle sprite is chosen by `kind` through a UI-only mapping, drawn so its nose points along `heading` (0 = north, clockwise).

## Acceptance criteria

- [ ] The taxiing Vehicle moves continuously between updates, with no visible jumps at the 500 ms mock tick.
- [ ] Headings crossing 0/360 turn the short way in both directions (tested).
- [ ] The Vehicle stops exactly at its last reported position if updates stop, and keeps its last heading.
- [ ] Motion tests cover midpoint, clamping at the target, both heading wrap directions, and the stationary case.
- [ ] There is one animation loop for all Vehicles, and it stops when no Vehicle needs animating or the page is hidden.
- [ ] Vehicle sprite orientation matches `heading` visually on at least a horizontal and a vertical edge.

## Blocked by

- 03-spawn-flight-live-taxi
