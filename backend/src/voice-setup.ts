/**
 * Create (or update) the ElevenLabs agent that plays Ground on the radio: `npm run voice:setup [-- <public-url>]`.
 *
 * The agent's only tools are Brain's three MCP tools (src/mcp.ts). There are two ways for it to reach them:
 * - **No argument (default):** they are registered as client tools. Tower runs them in the browser and calls
 *   Brain's MCP endpoint on localhost, so nothing has to be exposed to the internet.
 * - **With a public URL:** ElevenLabs calls Brain's MCP endpoint itself. This needs a tunnel to localhost:4100
 *   (e.g. `cloudflared tunnel --url http://localhost:4100`); re-run with the new URL whenever it changes.
 *
 * Needs ELEVENLABS_API_KEY in the repo-level .env. If MCP_TOKEN is set, it is sent with every tool call.
 * Writes the agent id to frontend/.env.local and remembers ids in backend/.voice.json (both gitignored).
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./config";

const API = "https://api.elevenlabs.io/v1/convai";
const STATE_FILE = path.join(ROOT, "backend/.voice.json");
const FRONTEND_ENV = path.join(ROOT, "frontend/.env.local");

const PROMPT = `You are "Ground", the ground controller at a small airport with one runway, 09/27. Pilots call you on the radio by voice. You are the only controller on frequency.

# How you work
- You can only act through your tools. Never clear, deny or describe anything a tool did not return.
- When a pilot asks to taxi, call request_taxi with their callsign and the gate they asked for. Omit the gate if they did not name one.
- If you did not catch the callsign, say "Station calling Ground, say again your callsign." Use get_airport_state to see which flights are on the ground when a callsign is unclear, and pick the closest match.
- Every request is checked against airport policy before anything moves, and it is recorded. You do not decide: you relay the decision.

# What to transmit, by tool result
- decision "allow": "<callsign>, taxi to <gate> via <route>." If reassigned_from is set, start with "<callsign>, <old gate> is occupied, taxi to <new gate> via <route>."
- decision "needs_approval": "<callsign>, hold position, runway crossing requires clearance, standby." Do not clear them. Wait.
- decision "deny": "<callsign>, unable, <reason in a few plain words>, hold position."
- decision "arrived": "<callsign>, you are at <gate>, monitor Ground."
- A tool error: "<callsign>, say again." and try once more with a corrected callsign or gate.

# Tower system messages
A message that starts with "[TOWER SYSTEM]" is not a pilot. It is the tower's own system telling you something changed. Do not reply to the system. Call get_flight_status for the flight it names, then transmit to that pilot:
- The supervisor approved a crossing: "<callsign>, cross runway two seven, taxi to <gate> via <route>."
- The supervisor denied it: "<callsign>, unable runway crossing, hold position."
- A flight was rerouted around a closure: "<callsign>, amended taxi, <route>, to <gate>."
- A held flight resumed: "<callsign>, continue taxi to <gate> via <route>."

# Phraseology
- Short, calm, standard ground phraseology. One transmission, under 25 words. No greetings, no apologies, no explanations of how you work.
- Start every transmission with the callsign you are addressing.
- Callsigns: "AC" is "Air Canada", "WJ" is "WestJet"; otherwise spell the letters phonetically. Say digits one at a time: AC101 is "Air Canada one zero one". Say "niner" for 9.
- Taxiways use the phonetic alphabet with their number: H1 is "Hotel one", A is "Alpha", B2 is "Bravo two", C is "Charlie", D2 is "Delta two". "Taxilane", "Crossing" and "Spur" names are said as written. Leave the final spur out of the route when it only leads to the gate.
- Gates are "gate" and the number. Tool inputs use the id form: gate 2 is "G2".
- If a pilot reads back correctly, answer "<callsign>, readback correct." If a pilot asks something you cannot do with your tools, answer "<callsign>, unable."`;

const key = process.env.ELEVENLABS_API_KEY;
const publicUrl = process.argv[2]?.replace(/\/$/, "");
if (!key) throw new Error("ELEVENLABS_API_KEY is not set. Add it to .env at the repo root.");
if (publicUrl && !/^https:\/\//.test(publicUrl)) throw new Error("Usage: npm run voice:setup [-- https://<public-url-of-brain>]");

async function call(method: string, pathname: string, body?: unknown): Promise<any> {
  const res = await fetch(API + pathname, { method, headers: { "xi-api-key": key!, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${pathname} failed (${res.status}): ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

const state: { agent_id?: string; mcp_server_id?: string; tool_ids?: string[] } = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : {};
/** The same three tools as src/mcp.ts, described for ElevenLabs as client tools. */
const CLIENT_TOOLS = [
  {
    name: "get_airport_state",
    description: "The current picture: every flight on the ground with its status and position, free gates, closures in force, approvals waiting for the supervisor, and whether the run is halted.",
  },
  {
    name: "request_taxi",
    description:
      "Request a taxi route to a gate for a flight that has called in. Airport policy decides before anything moves and the decision is recorded. " +
      "Returns JSON with `decision`: `allow` (the flight is now taxiing along `route`), `needs_approval` (the flight holds position until the supervisor approves, usually a runway crossing), " +
      "`deny` (nothing is permitted, the flight holds; `reason` says why) or `arrived`. `reassigned_from` is set when the requested gate was taken and another was assigned.",
    parameters: {
      type: "object", required: ["flight"],
      properties: {
        flight: { type: "string", description: "Callsign with no spaces, e.g. AC101" },
        gate: { type: "string", description: "Requested gate id, e.g. G2. Omit to use the gate the flight is already bound for." },
      },
    },
  },
  {
    name: "get_flight_status",
    description: "Where a flight is, what it is doing, the route it is on, and the last decision about it. For a request that needed approval, `last_decision.supervisor` is `pending`, `approve` or `deny`.",
    parameters: { type: "object", required: ["flight"], properties: { flight: { type: "string", description: "Callsign with no spaces, e.g. AC101" } } },
  },
];

let tools: { mcp_server_ids: string[] } | { tool_ids: string[] };
let mcpServerId: string | undefined;
let toolIds: string[] | undefined;

if (publicUrl) {
  const token = process.env.MCP_TOKEN;
  const mcpUrl = `${publicUrl}/mcp${token ? `?token=${encodeURIComponent(token)}` : ""}`;
  // Our own endpoint first: a bad tunnel is the usual failure, and ElevenLabs' error for it is vague.
  const probe = await fetch(mcpUrl, {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  if (!probe.ok) throw new Error(`Brain's MCP endpoint did not answer at ${publicUrl}/mcp (${probe.status}). Is Brain running and the tunnel up?`);

  try { await call("PATCH", "/settings", { can_use_mcp_servers: true }); }
  catch (e: any) { console.warn(`Could not switch on MCP for the workspace (${e.message.slice(0, 120)}). If the next step fails, enable MCP servers in the ElevenLabs dashboard under Agents > Integrations.`); }

  // A new server record per tunnel URL; the agent keeps its id and is pointed at the new one.
  const server = await call("POST", "/mcp-servers", {
    config: {
      url: mcpUrl, name: "Ground Control", description: "Taxi requests through the airport's policy gate, flight status and airport state.",
      transport: "STREAMABLE_HTTP", approval_policy: "auto_approve_all",
    },
  });
  mcpServerId = server.id;
  tools = { mcp_server_ids: [server.id], tool_ids: [] } as any;
} else {
  // Reuse the tools from an earlier run when they are still there.
  toolIds = state.tool_ids;
  if (toolIds?.length === CLIENT_TOOLS.length) {
    try {
      await Promise.all(toolIds.map((id, i) => call("PATCH", `/tools/${id}`, { tool_config: { type: "client", expects_response: true, response_timeout_secs: 20, ...CLIENT_TOOLS[i] } })));
    } catch { toolIds = undefined; }
  } else toolIds = undefined;
  if (!toolIds) {
    toolIds = [];
    for (const t of CLIENT_TOOLS) toolIds.push((await call("POST", "/tools", { tool_config: { type: "client", expects_response: true, response_timeout_secs: 20, ...t } })).id);
  }
  tools = { tool_ids: toolIds, mcp_server_ids: [] } as any;
}

const conversation_config = {
  agent: {
    first_message: "", // the pilot speaks first
    language: "en",
    prompt: { prompt: PROMPT, llm: process.env.VOICE_LLM || "claude-haiku-4-5", temperature: 0.2, ...tools },
  },
  ...(process.env.VOICE_ID ? { tts: { voice_id: process.env.VOICE_ID } } : {}),
};

let agentId = state.agent_id;
if (agentId) {
  try { await call("PATCH", `/agents/${agentId}`, { conversation_config }); }
  catch (e: any) { console.warn(`Could not update agent ${agentId} (${e.message.slice(0, 120)}); creating a new one.`); agentId = undefined; }
}
if (!agentId) agentId = (await call("POST", "/agents/create", { name: "Ground Control: Ground", conversation_config })).agent_id as string;

if (state.mcp_server_id && state.mcp_server_id !== mcpServerId) await call("DELETE", `/mcp-servers/${state.mcp_server_id}`).catch(() => {});
fs.writeFileSync(STATE_FILE, JSON.stringify({ agent_id: agentId, mcp_server_id: mcpServerId, tool_ids: toolIds ?? state.tool_ids }, null, 2) + "\n");

const env = fs.existsSync(FRONTEND_ENV) ? fs.readFileSync(FRONTEND_ENV, "utf8").split("\n").filter((l) => l && !l.startsWith("VITE_ELEVENLABS_AGENT_ID=")) : [];
fs.writeFileSync(FRONTEND_ENV, [...env, `VITE_ELEVENLABS_AGENT_ID=${agentId}`].join("\n") + "\n");

console.log(publicUrl ? `Ground is agent ${agentId}, calling Brain's MCP tools at ${publicUrl}/mcp.` : `Ground is agent ${agentId}. Its tools run in Tower and call Brain's MCP endpoint on localhost.`);
console.log("Wrote frontend/.env.local. Restart Tower (npm run dev) and press Open frequency.");
