import { API_URL } from "./api";

/** The controller's MCP tools on Brain (backend/src/mcp.ts). */
export const MCP_TOOLS = ["get_airport_state", "request_taxi", "get_flight_status"] as const;
export type McpTool = (typeof MCP_TOOLS)[number];

/** The JSON-RPC message out of an MCP streamable-HTTP response, which is either plain JSON or one SSE `data:` line. */
export function parseMcpResponse(contentType: string | null, body: string): any {
  if (!contentType?.includes("text/event-stream")) return JSON.parse(body);
  const data = body.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
  return JSON.parse(data);
}

let nextId = 1;

/**
 * Call one of Brain's MCP tools and return its text result, for the voice agent to read.
 * Errors come back as text too ("ERROR: ..."), so the agent can say "say again" instead of going silent.
 */
export async function callMcpTool(name: McpTool, args: Record<string, unknown> = {}, fetcher: typeof fetch = fetch): Promise<string> {
  try {
    const res = await fetcher(`${API_URL}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args } }),
    });
    const message = parseMcpResponse(res.headers.get("content-type"), await res.text());
    if (message.error) return `ERROR: ${message.error.message}`;
    const text = (message.result?.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
    return message.result?.isError ? `ERROR: ${text}` : text;
  } catch (e) {
    return `ERROR: the tower system is unreachable (${(e as Error).message})`;
  }
}
