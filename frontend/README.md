# Tower (frontend)

Vite + React + TypeScript. Plain SVG map, one `requestAnimationFrame` loop. Talks to Brain only through `docs/contract/` (imported via the `@contract` alias).

## Run

```sh
cd frontend
npm install
npm run mock   # mock Brain on http://localhost:4000 (disposable, see mock/)
npm run dev    # Tower on http://localhost:5173
npm test       # Vitest unit tests
```

Point at another server with `VITE_API_URL` (see `.env.example`); the websocket URL is derived from it.

## Level 0 demo

1. Open http://localhost:5173, choose Gate 1, click **Spawn flight**: the Vehicle taxis RX1 → G1.
2. Force failures on the mock while it taxis:
   - `curl -XPOST localhost:4000/dev/gap`: next message skips a `seq`; the UI refetches the snapshot and carries on.
   - `curl -XPOST localhost:4000/dev/drop`: drops the websocket; the UI shows `disconnected`, reconnects and resyncs.
   - `curl -XPOST localhost:4000/dev/halt` / `/dev/resume`: flips run status.
3. **Reset scenario** clears the Vehicle (`sim.reset`).

## Layout

- `src/lib/projection.ts`: `[lon, lat]` ↔ SVG, north up, `cos(lat)` scaling.
- `src/lib/sync.ts`: snapshot-and-stream rules (buffer, drop `seq <=`, gap/reconnect/reset refetch).
- `src/state/reducer.ts`: pure state updates for snapshot and every `WsMessage`.
- `src/lib/motion.ts` + `motionController.ts`: easing and the single animation loop (no per-frame React renders).
- `mock/`: scripted-playback server. Delete when Brain's server is live.
