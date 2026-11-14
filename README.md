# Ground Control

An air-traffic-style agent that moves aircraft around an airport map under rules MongoDB enforces. See `docs/mvp-plan.md`.

- **Brain** (`backend/`): API, simulation and change-stream relay on MongoDB.
- **Tower** (`frontend/`): the live map UI.
- They meet only at `docs/contract/`.

## Quick start (local MongoDB)

Needs Node 22+ and Docker (Docker Desktop or OrbStack).

```sh
docker compose up -d --wait         # MongoDB 7 as a single-node replica set (change streams need one)
cd backend && npm install && npm run seed && npm run dev    # Brain on :4100
cd frontend && npm install && npm run dev    # Tower on :5173, talks to Brain on :4100 by default
```

No `.env` is needed: Brain defaults to `mongodb://localhost:27017/?replicaSet=rs0&directConnection=true`.

- **After pulling Brain changes, run `npm run seed` again** (safe to re-run) and restart Brain. Without the seeded policies the policy gate allows everything, and Levels 1 and 2 look broken.
- Check Levels 1 and 2 end to end with Brain running: `node scripts/e2e-levels-1-2.mjs`. It resets the run, then walks spawn, approval, closure, halt and resume and checks the ledger. It prints one line per step and exits non-zero on the first failure.
- Wipe the local data: `docker compose down -v`, then `docker compose up -d --wait` and `npm run seed` again.
- Stop it: `docker compose down` (data is kept in a Docker volume).
- Use Atlas instead: set `MONGODB_URI` in `.env` (see `.env.example`). Use a different `MONGODB_DB` per person on a shared cluster, because everyone on one database shares one scenario.
- No Docker, or `mongod` won't start? Run `mongod --replSet rs0 --dbpath <dir>` yourself, then run `mongosh --eval "rs.initiate({_id:'rs0',members:[{_id:0,host:'localhost:27017'}]})"` once.

### Known issue: MongoDB 8 on OrbStack

The compose file pins `mongo:7.0` on purpose. MongoDB 8 refuses to start on Linux kernels 6.19 to 7.0.13, which is what current OrbStack VMs run (SERVER-121912). Move to `mongo:8` once the OrbStack kernel is newer.
