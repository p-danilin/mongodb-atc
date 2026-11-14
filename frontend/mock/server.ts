/** Mock Brain for Tower development. `npm run mock`. Port from MOCK_PORT (default 4000). */
import http from "node:http";
import { WebSocketServer } from "ws";
import type { SpawnFlightRequest } from "../../docs/contract/types";
import { World, graph } from "./world";

const world = new World();
const PORT = Number(process.env.MOCK_PORT ?? 4000);

type Handler = (body: any, url: URL) => unknown | Promise<unknown>;
const fail = (status: number, code: string, message: string) => Object.assign(new Error(message), { status, code });

/** Add new endpoints here (Level 1: zones; Level 2: approvals, halt, resume, redteam). */
const routes: Record<string, Handler> = {
  "GET /api/graph": () => graph,
  "GET /api/state": () => world.snapshot(),
  "POST /api/sim/start": () => world.run,
  "POST /api/sim/reset": () => world.reset(),
  "POST /api/flights": (b: SpawnFlightRequest) => {
    if (!b?.gate || !graph.nodes.some((n) => n._id === b.gate && n.type === "gate")) throw fail(400, "bad_request", "gate must be a gate node id");
    return world.spawnFlight(b.gate, b.flight);
  },
  // Dev-only controls (not in the contract): force failure cases.
  "POST /dev/gap": (_b, url) => { world.forceGap(Number(url.searchParams.get("n") ?? 1)); return { ok: true, note: "next message skips seq" }; },
  "POST /dev/drop": () => { world.dropClients(); return { ok: true }; },
  "POST /dev/halt": () => { world.run = { ...world.run, status: "halted", halted_by: "supervisor-1", halted_at: new Date().toISOString() }; world.emit("run.halted", world.run); return world.run; },
  "POST /dev/resume": () => { const { halted_by, halted_at, ...rest } = world.run; world.run = { ...rest, status: "running" }; world.emit("run.resumed", world.run); return world.run; },
};

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }
  const url = new URL(req.url ?? "/", "http://localhost");
  const handler = routes[`${req.method} ${url.pathname}`];
  if (!handler) { res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: { code: "not_found", message: url.pathname } })); return; }
  try {
    let raw = ""; for await (const c of req) raw += c;
    const out = await handler(raw ? JSON.parse(raw) : undefined, url);
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out));
  } catch (e: any) {
    res.writeHead(e.status ?? 400, { "content-type": "application/json" }).end(JSON.stringify({ error: { code: e.code ?? "bad_request", message: e.message } }));
  }
});

const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (ws) => {
  const client = { send: (d: string) => ws.send(d), close: () => ws.terminate() };
  world.clients.add(client);
  ws.on("close", () => world.clients.delete(client));
});

server.listen(PORT, () => console.log(`mock Brain on http://localhost:${PORT} (ws /ws). Dev: POST /dev/gap, /dev/drop, /dev/halt, /dev/resume`));
