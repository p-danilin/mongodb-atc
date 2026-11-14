/**
 * The controller's tools, served over MCP at `POST /mcp` (streamable HTTP, stateless).
 *
 * These are the only things the voice agent can do. None of them writes to Mongo directly: a taxi
 * request goes through the policy gate, which records the decision before anything moves.
 */
import type http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { HttpError, type World } from "./world";

/** "gate 2", "Gate Two"-style digits, "G2" or "2" -> "G2". */
export function gateId(spoken: string | undefined): string | undefined {
  const digit = spoken?.match(/\d+/)?.[0];
  return digit ? `G${Number(digit)}` : spoken?.trim() || undefined;
}

function build(world: World): McpServer {
  const server = new McpServer({ name: "ground-control", version: "0.1.0" });
  const reply = async (fn: () => Promise<unknown>) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await fn()) }] }; }
    catch (e) {
      if (!(e instanceof HttpError)) console.error("mcp tool failed:", e);
      return { isError: true, content: [{ type: "text" as const, text: e instanceof HttpError ? e.message : "Internal error" }] };
    }
  };

  server.registerTool("get_airport_state", {
    description: "The current picture: every flight on the ground with its status and position, free gates, closures in force, approvals waiting for the supervisor, and whether the run is halted.",
    inputSchema: {},
  }, () => reply(() => world.airportState()));

  server.registerTool("request_taxi", {
    description:
      "Request a taxi route to a gate for a flight that has called in. The policy gate decides before anything moves and the decision is recorded. " +
      "Returns `decision`: `allow` (the flight is now taxiing along `route`), `needs_approval` (the flight holds position until the supervisor approves, usually a runway crossing), " +
      "`deny` (nothing is permitted, the flight holds; `reason` says why) or `arrived`. `reassigned_from` is set when the requested gate was taken and another was assigned.",
    inputSchema: {
      flight: z.string().describe("Callsign, e.g. AC101"),
      gate: z.string().optional().describe("Requested gate, e.g. G2 or 'gate 2'. Omit to use the gate the flight is already bound for."),
    },
  }, ({ flight, gate }) => reply(() => world.requestTaxi(flight, gateId(gate))));

  server.registerTool("get_flight_status", {
    description: "Where a flight is, what it is doing, the route it is on, and the last decision about it. For a request that needed approval, `last_decision.supervisor` is `pending`, `approve` or `deny`.",
    inputSchema: { flight: z.string().describe("Callsign, e.g. AC101") },
  }, ({ flight }) => reply(() => world.flightStatus(flight)));

  return server;
}

/** Handle one MCP request. Stateless: a fresh server and transport per request, no sessions to track. */
export async function handleMcp(world: World, req: http.IncomingMessage, res: http.ServerResponse, body: unknown) {
  if (req.method !== "POST") {
    res.writeHead(405, { "content-type": "application/json", allow: "POST" }).end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null }));
    return;
  }
  const server = build(world);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => { void transport.close(); void server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}
