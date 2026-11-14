# Tower (frontend)

Vite + React + TypeScript. Plain SVG map, one `requestAnimationFrame` loop. Talks to Brain only through `docs/contract/` (imported via the `@contract` alias).

## Run

Needs Brain running (see the root README: `docker compose up -d --wait`, then `cd backend && npm run seed && npm run dev`).

```sh
cd frontend
npm install
npm run dev    # Tower on http://localhost:5173, talking to Brain on http://localhost:4100
npm test       # Vitest unit tests
```

Re-run `npm run seed` in `backend/` after pulling Brain changes, or the policy gate has no policies and allows everything.

With Brain running, check Levels 1 and 2 end to end from the repo root: `node scripts/e2e-levels-1-2.mjs`. It resets the run and walks spawn at Gate 5, approval, closure, halt and resume, then checks the ledger.

Point at another server with `VITE_API_URL` (see `.env.example`); the websocket URL is derived from it.

To check reconnect and resync by hand, stop and restart Brain: the UI shows `disconnected`, reconnects and refetches the snapshot. A `seq` gap is covered by `src/lib/sync.test.ts`.

## Layout

- `src/lib/projection.ts`: `[lon, lat]` ↔ SVG, north up, `cos(lat)` scaling.
- `src/lib/sync.ts`: snapshot-and-stream rules (buffer, drop `seq <=`, gap/reconnect/reset refetch).
- `src/state/reducer.ts`: pure state updates for snapshot and every `WsMessage`.
- `src/lib/motion.ts` + `motionController.ts`: easing and the single animation loop (no per-frame React renders).
- `src/lib/approvals.ts`, `src/lib/routeGeometry.ts`: queue-row labels and route orientation (pure, tested).
- `src/components/ApprovalQueue.tsx`: pending approvals; a row's hover highlights its proposed route on the map.
- `src/lib/ledgerFeed.ts`: the current run's ledger, ordered and deduplicated by `n`, with filters (pure, tested). `src/components/Feed.tsx` shows it as the Events tail and the Ledger tab.
- `src/lib/closureGeometry.ts`: the 50 m closure octagon, countdown text and the reason from the nearest taxiway. `ClosureLayer.tsx` and `MapOverlays.tsx` draw closures, the Drop closure controls and the halt banner.
- `src/lib/controls.ts`: which buttons are enabled and why not (Spawn, Approve, Deny, Red team), and the header chip text.
- `src/lib/vehicleFx.ts`: the amber ring and red denial flash, drawn by the same animation loop.
