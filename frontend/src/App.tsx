import { useEffect, useState } from "react";
import type { Graph } from "@contract/types";
import { api, browserTransport } from "./lib/api";
import { createSync } from "./lib/sync";
import { store, useSelector, type Tab } from "./state/store";
import { AirportMap } from "./components/AirportMap";
import { ApprovalQueue, ApprovalsChip, PendingCount } from "./components/ApprovalQueue";
import { Feed } from "./components/Feed";
import { ConnectionIndicator, LegendCard, RedTeamAlert, RunControls, RunStatus, ScenarioCard } from "./components/Panels";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";

export default function App() {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ready = useSelector((s) => s.ready);
  const tab = useSelector((s) => s.tab);

  useEffect(() => {
    let cancelled = false;
    api.graph().then((g) => !cancelled && setGraph(g), (e) => !cancelled && setError(String(e.message ?? e)));
    const sync = createSync({
      transport: browserTransport,
      onSnapshot: (snap) => {
        store.snapshot(snap);
        // Reload the current run's ledger on load, reconnect, gap and reset; live entries keep arriving meanwhile.
        api.ledger(snap.run._id).then((entries) => store.loadLedger(entries, snap.run._id), () => {});
      },
      onMessage: store.message,
      onStatus: store.setConnection,
    });
    sync.start();
    return () => { cancelled = true; sync.stop(); };
  }, []);

  const gates = graph?.nodes.filter((n) => n.type === "gate").map((n) => ({ id: n._id, name: n.name })) ?? [];

  const gateNames = Object.fromEntries(gates.map((g) => [g.id, g.name]));

  return (
    <TooltipProvider>
      <div className="grid h-full grid-rows-[auto_minmax(0,1fr)]">
        <header className="flex items-center justify-between border-b bg-card px-5 py-2.5">
          <h1 className="text-base font-semibold tracking-tight">Ground Control <span className="font-normal text-muted-foreground">Tower</span></h1>
          <div className="flex items-center gap-3">
            <ApprovalsChip />
            <RunControls />
            <RunStatus />
            <ConnectionIndicator />
          </div>
        </header>
        <div className="grid min-h-0 gap-4 p-4 max-lg:grid-rows-[60vh_auto] lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-[minmax(0,1fr)]">
          <main className="min-h-0 overflow-hidden rounded-xl border bg-map-ground">
            {error && <p role="alert" className="p-4 text-sm text-destructive">Cannot load the airport graph: {error}. Check that the server at VITE_API_URL is running.</p>}
            {!error && !(graph && ready) && <p className="p-4 text-sm text-muted-foreground">Loading airport…</p>}
            {graph && ready && <AirportMap graph={graph} />}
          </main>
          <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto [&>*]:shrink-0">
            <ScenarioCard gates={gates} />
            <LegendCard />
            <RedTeamAlert />
            <Card size="sm">
              <CardContent>
                <Tabs value={tab} onValueChange={(v) => store.setTab(v as Tab)}>
                  <TabsList className="w-full">
                    <TabsTrigger value="events">Events</TabsTrigger>
                    <TabsTrigger value="approvals">Approvals<PendingCount /></TabsTrigger>
                    <TabsTrigger value="ledger">Ledger</TabsTrigger>
                  </TabsList>
                  <TabsContent value="events"><Feed mode="events" /></TabsContent>
                  <TabsContent value="approvals"><ApprovalQueue gateNames={gateNames} /></TabsContent>
                  <TabsContent value="ledger"><Feed mode="ledger" /></TabsContent>
                </Tabs>
              </CardContent>
            </Card>
            <Card size="sm">
              <CardHeader><CardTitle>Closures</CardTitle></CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Switch on <strong>Drop closure</strong> on the map, pick how long it lasts, then click where to close. Vehicles whose routes it touches are replanned. Click a closure to select it and remove it early. Closures can be dropped while the run is halted.
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </TooltipProvider>
  );
}
