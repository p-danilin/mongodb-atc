/** Brain: the Ground Control API server. `npm run dev`. Contract: docs/contract/api.md. */
import http from "node:http";
import { WebSocketServer } from "ws";
import type { SpawnFlightRequest } from "../../docs/contract/types";
import { config } from "./config";
import { connect } from "./db";
import { Hub } from "./hub";
import { Sim } from "./sim";
import { startRelay } from "./stream";
import { HttpError, World, loadGraph } from "./world";

const database = await connect();
const graph = await loadGraph(database);
const hub = new Hub();
const sim = new Sim(database, graph);
const world = new World(database, hub, sim, graph);
await world.init();
const relay = startRelay(database, hub);
const resumed = await sim.resume();
sim.start();

type Handler = (body: any, url: URL) => unknown | Promise<unknown>;

/** Level 1 adds zones; Level 2 adds approvals, halt, resume, redteam and ledger. */
const routes: Record<string, Handler> = {
  "GET /api/graph": () => graph,
  "GET /api/state": () => world.snapshot(),
  "POST /api/sim/start": () => world.currentRun(),
  "POST /api/sim/reset": () => world.reset(),
  "POST /api/flights": (b: SpawnFlightRequest) => {
    if (typeof b?.gate !== "string") throw new HttpError(400, "bad_request", "gate is required");
    if (b.flight !== undefined && typeof b.flight !== "string") throw new HttpError(400, "bad_request", "flight must be a string");
    return world.spawnFlight(b.gate, b.flight);
  },
};

const json = (res: http.ServerResponse, status: number, body: unknown) =>
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }
  const url = new URL(req.url ?? "/", "http://localhost");
  const handler = routes[`${req.method} ${url.pathname}`];
  if (!handler) { json(res, 404, { error: { code: "not_found", message: `${req.method} ${url.pathname}` } }); return; }
  try {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    let body: unknown;
    try { body = raw ? JSON.parse(raw) : undefined; } catch { throw new HttpError(400, "bad_request", "body is not valid JSON"); }
    json(res, 200, await handler(body, url));
  } catch (e: any) {
    if (e instanceof HttpError) { json(res, e.status, { error: { code: e.code, message: e.message } }); return; }
    console.error(`${req.method} ${url.pathname} failed:`, e);
    json(res, 500, { error: { code: "internal", message: "Internal error" } });
  }
});

const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (ws) => {
  const client = { send: (d: string) => ws.send(d) };
  hub.add(client);
  ws.on("close", () => hub.remove(client));
  ws.on("error", () => hub.remove(client));
});

server.listen(config.port, () => {
  console.log(`Brain on http://localhost:${config.port} (ws /ws), db "${config.dbName}", run ${world.currentRun()._id}, tick ${config.tickMs} ms`);
  if (resumed) console.log(`resumed ${resumed} vehicle(s) mid-taxi`);
});

async function shutdown() {
  await sim.stop();
  await relay.stop();
  server.close();
  await database.client.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
