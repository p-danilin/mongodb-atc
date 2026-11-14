/** Brain: the Ground Control API server. `npm run dev`. Contract: docs/contract/api.md. */
import http from "node:http";
import { WebSocketServer } from "ws";
import type { CreateZoneRequest, HaltRequest, ResolveApprovalRequest, SpawnFlightRequest } from "../../docs/contract/types";
import { config } from "./config";
import { connect } from "./db";
import { Hub } from "./hub";
import { Ledger } from "./ledger";
import { gateId, handleMcp } from "./mcp";
import { Sim } from "./sim";
import { startRelay } from "./stream";
import { speak } from "./tts";
import { HttpError, World, loadGraph } from "./world";

const database = await connect();
const graph = await loadGraph(database);
const hub = new Hub();
const sim = new Sim(database);
const world = new World(database, hub, sim, new Ledger(database), graph);
const relay = startRelay(database, hub, world);
const picked = await world.init();
sim.start();

type Handler = (body: any, url: URL, params: Record<string, string>) => unknown | Promise<unknown>;
const NO_CONTENT = Symbol("204");

/** The contract in docs/contract/api.md. A `:name` path segment is passed in `params`. */
const routes: Record<string, Handler> = {
  "GET /api/graph": () => graph,
  "GET /api/state": () => world.snapshot(),
  "POST /api/sim/start": () => world.currentRun(),
  "POST /api/sim/reset": () => world.reset(),
  "POST /api/flights": (b: SpawnFlightRequest) => {
    if (typeof b?.gate !== "string") throw new HttpError(400, "bad_request", "gate is required");
    if (b.flight !== undefined && typeof b.flight !== "string") throw new HttpError(400, "bad_request", "flight must be a string");
    // `hold` (not in the contract): the flight waits at the runway exit for its pilot to call in.
    return world.spawnFlight(b.gate, b.flight, typeof (b as any).hold === "boolean" ? (b as any).hold : undefined);
  },
  // The controller's tools as plain HTTP, mirroring the MCP tools in mcp.ts.
  "GET /api/pilot/state": () => world.airportState(),
  "POST /api/pilot/taxi": (b: { flight: string; gate?: string }) => world.requestTaxi(b?.flight, gateId(b?.gate)),
  "GET /api/pilot/status/:flight": (_b, _url, p) => world.flightStatus(p.flight),
  "POST /api/zones": (b: CreateZoneRequest) => world.createZone(b),
  "DELETE /api/zones/:id": async (_b, _url, p) => { await world.removeZone(p.id); return NO_CONTENT; },
  "GET /api/ledger": (_b, url) => world.ledgerFor(url.searchParams.get("run_id") ?? undefined),
  "GET /api/approvals": (_b, url) => {
    const status = url.searchParams.get("status") ?? "pending";
    if (status !== "pending") throw new HttpError(400, "bad_request", 'only status=pending is supported');
    return world.pendingApprovals();
  },
  "POST /api/approvals/:id": (b: ResolveApprovalRequest, _url, p) => world.resolveApproval(p.id, b),
  "POST /api/run/halt": (b: HaltRequest | undefined) => world.halt(typeof b?.reason === "string" ? b.reason : undefined),
  "POST /api/run/resume": () => world.resume(),
  "POST /api/redteam/bad-route": () => world.redteam(),
};

const table = Object.entries(routes).map(([key, handler]) => {
  const [method, path] = key.split(" ");
  return { method, parts: path.split("/"), handler };
});

function match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | null {
  const parts = pathname.split("/");
  for (const r of table) {
    if (r.method !== method || r.parts.length !== parts.length) continue;
    const params: Record<string, string> = {};
    if (r.parts.every((p, i) => (p.startsWith(":") ? ((params[p.slice(1)] = decodeURIComponent(parts[i])), parts[i] !== "") : p === parts[i]))) return { handler: r.handler, params };
  }
  return null;
}

const json = (res: http.ServerResponse, status: number, body: unknown) =>
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type, mcp-session-id, mcp-protocol-version, authorization");
  res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/mcp") {
    // The MCP endpoint is reachable from outside through the tunnel, so it can require a token.
    const token = process.env.MCP_TOKEN;
    if (token && url.searchParams.get("token") !== token && req.headers.authorization !== `Bearer ${token}`) {
      json(res, 401, { jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null });
      return;
    }
    try {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      await handleMcp(world, req, res, raw ? JSON.parse(raw) : undefined);
    } catch (e) {
      console.error("mcp request failed:", e);
      if (!res.headersSent) json(res, 400, { jsonrpc: "2.0", error: { code: -32700, message: "Bad request" }, id: null });
    }
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/voice/speak") {
    try {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const b = raw ? JSON.parse(raw) : {};
      if ((b.speaker !== "pilot" && b.speaker !== "atc") || typeof b.text !== "string" || !b.text.trim() || b.text.length > 500) throw new HttpError(400, "bad_request", "speaker (pilot|atc) and text (1-500 chars) are required");
      res.writeHead(200, { "content-type": "audio/mpeg" }).end(await speak(b.speaker, b.text));
    } catch (e: any) {
      if (e instanceof HttpError) json(res, e.status, { error: { code: e.code, message: e.message } });
      else if (e instanceof SyntaxError) json(res, 400, { error: { code: "bad_request", message: "body is not valid JSON" } });
      else { console.error("voice failed:", e); json(res, 500, { error: { code: "internal", message: "Internal error" } }); }
    }
    return;
  }
  const found = match(req.method ?? "", url.pathname);
  if (!found) { json(res, 404, { error: { code: "not_found", message: `${req.method} ${url.pathname}` } }); return; }
  try {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    let body: unknown;
    try { body = raw ? JSON.parse(raw) : undefined; } catch { throw new HttpError(400, "bad_request", "body is not valid JSON"); }
    const out = await found.handler(body, url, found.params);
    if (out === NO_CONTENT) res.writeHead(204).end(); else json(res, 200, out);
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
  if (picked.resumed || picked.zones) console.log(`picked up ${picked.resumed} vehicle(s) mid-taxi and ${picked.zones} active closure(s)`);
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
