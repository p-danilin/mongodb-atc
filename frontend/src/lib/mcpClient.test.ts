import { describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({ API_URL: "http://brain.test" }));
const { callMcpTool, parseMcpResponse } = await import("./mcpClient");

const reply = (body: string, contentType = "application/json") =>
  (async () => new Response(body, { headers: { "content-type": contentType } })) as unknown as typeof fetch;

describe("parseMcpResponse", () => {
  it("reads plain JSON", () => {
    expect(parseMcpResponse("application/json", '{"id":1,"result":{}}')).toEqual({ id: 1, result: {} });
  });
  it("reads the data line of an SSE response", () => {
    expect(parseMcpResponse("text/event-stream", 'event: message\ndata: {"id":1,"result":{"ok":true}}\n\n')).toEqual({ id: 1, result: { ok: true } });
  });
});

describe("callMcpTool", () => {
  it("posts a tools/call request and returns the tool's text", async () => {
    const fetcher = vi.fn(reply('event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"{\\"decision\\":\\"allow\\"}"}]}}\n\n', "text/event-stream"));
    expect(await callMcpTool("request_taxi", { flight: "AC101", gate: "G2" }, fetcher)).toBe('{"decision":"allow"}');
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://brain.test/mcp");
    expect(JSON.parse(init.body as string)).toMatchObject({ method: "tools/call", params: { name: "request_taxi", arguments: { flight: "AC101", gate: "G2" } } });
  });
  it("turns a tool error into text the agent can act on", async () => {
    expect(await callMcpTool("get_flight_status", { flight: "ZZ9" }, reply('{"jsonrpc":"2.0","id":2,"result":{"isError":true,"content":[{"type":"text","text":"No flight ZZ9 on the ground"}]}}')))
      .toBe("ERROR: No flight ZZ9 on the ground");
  });
  it("reports an unreachable server instead of throwing", async () => {
    const down = (async () => { throw new Error("fetch failed"); }) as unknown as typeof fetch;
    expect(await callMcpTool("get_airport_state", {}, down)).toMatch(/^ERROR: the tower system is unreachable/);
  });
});
