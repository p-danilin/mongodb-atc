import { useState, type ReactNode } from "react";
import { PlaneTakeoffIcon, RotateCcwIcon, OctagonIcon, PlayIcon } from "lucide-react";
import { api } from "../lib/api";
import { useSelector } from "../state/store";
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

/** Halt and resume are visible from day one so the screen structure is settled; they work at Level 2. */
export function RunControls() {
  const disabledButton = (label: string, icon: ReactNode) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0}><Button variant="outline" size="sm" disabled>{icon}{label}</Button></span>
      </TooltipTrigger>
      <TooltipContent>Kill switch arrives at Level 2</TooltipContent>
    </Tooltip>
  );
  return (
    <div className="flex items-center gap-2" data-testid="run-controls">
      {disabledButton("Halt", <OctagonIcon data-icon="inline-start" />)}
      {disabledButton("Resume", <PlayIcon data-icon="inline-start" />)}
    </div>
  );
}

export function ScenarioCard({ gates }: { gates: { id: string; name: string }[] }) {
  const [gate, setGate] = useState("G1");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
          <Button disabled={busy} onClick={() => act(() => api.spawnFlight({ gate }))}>
            <PlaneTakeoffIcon data-icon="inline-start" />Spawn flight
          </Button>
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

export function EmptyState({ title, body, level }: { title: string; body: string; level: string }) {
  return (
    <div className="flex flex-col items-start gap-1 rounded-md border border-dashed bg-muted/40 p-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{title}</span>
        <Badge variant="outline">{level}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
