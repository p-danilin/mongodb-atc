import type { Action, ActionId, CreateZoneRequest, Graph, LedgerEntry, RunId, Zone, ResolveApprovalRequest, Resolution, Run, Snapshot, SpawnFlightRequest, Vehicle, WsMessage } from "@contract/types";
import type { Transport } from "./sync";

export const API_URL: string = (import.meta.env.VITE_API_URL ?? "http://localhost:4100").replace(/\/$/, "");
export const WS_URL = API_URL.replace(/^http/, "ws") + "/ws";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(API_URL + path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error?.message ?? `${method} ${path} failed (${res.status})`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const api = {
  graph: () => request<Graph>("GET", "/api/graph"),
  state: () => request<Snapshot>("GET", "/api/state"),
  start: () => request<Run>("POST", "/api/sim/start"),
  reset: () => request<Run>("POST", "/api/sim/reset"),
  spawnFlight: (req: SpawnFlightRequest) => request<Vehicle>("POST", "/api/flights", req),
  createZone: (req: CreateZoneRequest) => request<Zone>("POST", "/api/zones", req),
  removeZone: (id: string) => request<void>("DELETE", `/api/zones/${encodeURIComponent(id)}`),
  halt: () => request<Run>("POST", "/api/run/halt", {}),
  resume: () => request<Run>("POST", "/api/run/resume"),
  redTeam: () => request<Action>("POST", "/api/redteam/bad-route"),
  ledger: (runId: RunId) => request<LedgerEntry[]>("GET", `/api/ledger?run_id=${encodeURIComponent(runId)}`),
  /** `id` is the action id, not an approval id. */
  resolveApproval: (id: ActionId, req: ResolveApprovalRequest) => request<Resolution>("POST", `/api/approvals/${encodeURIComponent(id)}`, req),
};

export const browserTransport: Transport = {
  fetchSnapshot: api.state,
  connect(h) {
    const ws = new WebSocket(WS_URL);
    ws.onopen = () => h.onOpen();
    ws.onmessage = (e) => { try { h.onMessage(JSON.parse(e.data) as WsMessage); } catch { /* ignore malformed */ } };
    ws.onclose = () => h.onClose();
    ws.onerror = () => ws.close();
    return { close: () => { ws.onclose = null; ws.close(); } };
  },
};
