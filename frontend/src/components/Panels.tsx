import { useState, type ReactNode } from "react";
import { PlaneTakeoffIcon, RotateCcwIcon, OctagonIcon, PlayIcon, ShieldAlertIcon, XIcon } from "lucide-react";
import { api } from "../lib/api";
import { redTeamControl, spawnControl } from "../lib/controls";
import { store, useSelector } from "../state/store";
import type { ConnectionStatus } from "../lib/sync";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const CONNECTION_DOT: Record<ConnectionStatus, string> = {
  connected: "bg-emerald-500", resyncing: "bg-amber-500 animate-pulse", disconnected: "bg-red-500",
};

export function ConnectionIndicator() {
  const c = useSelector((s) => s.connection);
  return (
    <Badge variant="outline" data-testid="connection" className="gap-1.5 capitalize">
      <span className={`size-1.5 rounded-full ${CONNECTION_DOT[c]}`} />{c}
    </Badge>
  );
}

export function RunStatus() {
  const status = useSelector((s) => s.run.status);
  return (
    <Badge variant={status === "halted" ? "destructive" : "secondary"} data-testid="run-status">
      Run {status}
    </Badge>
  );
}

/** Wraps a possibly disabled button so the reason shows on hover and keyboard focus. */
function WithReason({ reason, children }: { reason?: string; children: ReactNode }) {
  if (!reason) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild><span tabIndex={0}>{children}</span></TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

/** One kill switch: Halt while running, Resume while halted. No confirmation. Red team sits beside it. */
export function RunControls() {
  const run = useSelector((s) => s.run, (a, b) => a === b);
  const vehicles = useSelector((s) => s.vehicles);
  const zones = useSelector((s) => s.zones);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const halted = run.status === "halted";
  const red = redTeamControl(run, vehicles, zones);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setMsg(null);
    try { await fn(); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="flex items-center gap-2" data-testid="run-controls">
      {msg && <span role="alert" className="max-w-64 truncate text-sm text-destructive" title={msg}>{msg}</span>}
      <WithReason reason={red.reason}>
        <Button variant="outline" size="sm" disabled={!red.enabled || busy}
          onClick={() => act(async () => store.setRedTeamAlert(await api.redTeam()))}>
          <ShieldAlertIcon data-icon="inline-start" />Red team
        </Button>
      </WithReason>
      {halted ? (
        <Button size="sm" disabled={busy} onClick={() => act(api.resume)}><PlayIcon data-icon="inline-start" />Resume</Button>
      ) : (
        <Button size="sm" variant="destructive" disabled={busy} onClick={() => act(api.halt)}><OctagonIcon data-icon="inline-start" />Halt</Button>
      )}
    </div>
  );
}

/** Persistent proof of a red-team denial, built from the Action the button got back. */
export function RedTeamAlert() {
  const action = useSelector((s) => s.redTeamAlert);
  if (!action) return null;
  return (
    <Card size="sm" role="alert" data-testid="redteam-alert" className="border-red-300 bg-red-50">
      <CardHeader>
        <CardTitle className="text-red-900">Red team route refused</CardTitle>
        <Button variant="ghost" size="icon-sm" aria-label="Dismiss" onClick={() => store.setRedTeamAlert(null)}><XIcon /></Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 text-sm">
        <p>Denied by <span className="font-mono font-medium">{action.policy_ids.join(", ")}</span>: {action.reason}</p>
        <p className="text-muted-foreground">Recorded as <span className="font-mono">{action._id}</span></p>
        <div><Button size="sm" variant="outline" onClick={() => store.showInFeed(action._id)}>Show in feed</Button></div>
      </CardContent>
    </Card>
  );
}

export function ScenarioCard({ gates }: { gates: { id: string; name: string }[] }) {
  const [gate, setGate] = useState("G1");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const spawn = spawnControl(useSelector((s) => s.run, (a, b) => a === b));
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setMsg(null);
    try { await fn(); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Scenario</CardTitle>
        <CardDescription>Send an arrival from runway exit RX1 to a gate.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex gap-2">
          <Select value={gate} onValueChange={setGate}>
            <SelectTrigger className="w-32" aria-label="Gate"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {gates.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
              </SelectGroup>
            </SelectContent>
          </Select>
          <WithReason reason={spawn.reason}>
            <Button disabled={busy || !spawn.enabled} onClick={() => act(() => api.spawnFlight({ gate }))}>
              <PlaneTakeoffIcon data-icon="inline-start" />Spawn flight
            </Button>
          </WithReason>
          <Button variant="outline" disabled={busy} onClick={() => act(api.reset)}>
            <RotateCcwIcon data-icon="inline-start" />Reset
          </Button>
        </div>
        {msg && <p role="alert" className="text-sm text-destructive">{msg}</p>}
      </CardContent>
    </Card>
  );
}

function Swatch({ children }: { children: ReactNode }) {
  return <svg width="36" height="16" viewBox="0 0 36 16" aria-hidden className="shrink-0">{children}</svg>;
}

export function LegendCard() {
  const rows: { label: string; swatch: ReactNode }[] = [
    { label: "Taxiway", swatch: <Swatch><rect x="0" y="3" width="36" height="10" rx="2" fill="var(--map-taxi)" /><line x1="0" y1="8" x2="36" y2="8" stroke="var(--map-centerline)" strokeWidth="2" /></Swatch> },
    { label: "Apron", swatch: <Swatch><rect x="0" y="1" width="36" height="14" rx="3" fill="var(--map-apron)" /></Swatch> },
    { label: "Runway", swatch: <Swatch><rect x="0" y="2" width="36" height="12" fill="var(--map-runway)" /><line x1="3" y1="8" x2="33" y2="8" stroke="#f4f6f8" strokeWidth="1.5" strokeDasharray="6 4" /></Swatch> },
    { label: "Hold short, needs approval", swatch: <Swatch><line x1="18" y1="1" x2="18" y2="15" stroke="var(--map-hold)" strokeWidth="3" /></Swatch> },
    { label: "Planned route", swatch: <Swatch><line x1="0" y1="8" x2="36" y2="8" stroke="var(--map-route)" strokeWidth="5" strokeLinecap="round" /></Swatch> },
    { label: "Proposed, needs approval", swatch: <Swatch><line x1="0" y1="8" x2="36" y2="8" stroke="var(--map-pending)" strokeWidth="5" strokeLinecap="round" strokeDasharray="8 6" /></Swatch> },
    { label: "Closure", swatch: <Swatch><rect x="2" y="2" width="32" height="12" rx="3" fill="var(--map-closure)" fillOpacity="0.3" stroke="var(--map-closure)" strokeWidth="2" strokeDasharray="5 3" /></Swatch> },
    { label: "Waiting for approval", swatch: <Swatch><circle cx="18" cy="8" r="6" fill="#1d5fd8" /><circle cx="18" cy="8" r="7.5" fill="none" stroke="var(--map-pending)" strokeWidth="2" /></Swatch> },
    { label: "Route denied (flash)", swatch: <Swatch><circle cx="18" cy="8" r="6" fill="#1d5fd8" /><circle cx="18" cy="8" r="7.5" fill="var(--map-closure)" fillOpacity="0.35" stroke="var(--map-closure)" strokeWidth="2" /></Swatch> },
    { label: "Halted", swatch: <Swatch><circle cx="18" cy="8" r="6" fill="#8d959d" opacity="0.7" /></Swatch> },
    { label: "Gate", swatch: <Swatch><rect x="6" y="1" width="24" height="14" rx="3" fill="#16202b" /></Swatch> },
  ];
  return (
    <Card size="sm">
      <CardHeader><CardTitle>Legend</CardTitle></CardHeader>
      <CardContent>
        <ul className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm text-muted-foreground">
          {rows.map((r) => <li key={r.label} className="flex items-center gap-2">{r.swatch}<span>{r.label}</span></li>)}
        </ul>
      </CardContent>
    </Card>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-start gap-1 rounded-md border border-dashed bg-muted/40 p-3">
      <span className="text-sm font-medium">{title}</span>
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
