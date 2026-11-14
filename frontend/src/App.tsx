import { useEffect, useState } from "react";
import type { Graph } from "@contract/types";
import { api, browserTransport } from "./lib/api";
import { createSync } from "./lib/sync";
import { store, useSelector } from "./state/store";
import { AirportMap } from "./components/AirportMap";
import { ConnectionIndicator, EmptyState, LegendCard, RunControls, RunStatus, ScenarioCard } from "./components/Panels";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";

export default function App() {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ready = useSelector((s) => s.ready);

  useEffect(() => {
    let cancelled = false;
    api.graph().then((g) => !cancelled && setGraph(g), (e) => !cancelled && setError(String(e.message ?? e)));
    const sync = createSync({
      transport: browserTransport,
      onSnapshot: store.snapshot,
      onMessage: store.message,
      onStatus: store.setConnection,
    });
    sync.start();
    return () => { cancelled = true; sync.stop(); };
  }, []);

  const gates = graph?.nodes.filter((n) => n.type === "gate").map((n) => ({ id: n._id, name: n.name })) ?? [];

  return (
    <TooltipProvider>
      <div className="grid h-full grid-rows-[auto_minmax(0,1fr)]">
        <header className="flex items-center justify-between border-b bg-card px-5 py-2.5">
          <h1 className="text-base font-semibold tracking-tight">Ground Control <span className="font-normal text-muted-foreground">Tower</span></h1>
          <div className="flex items-center gap-3">
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
          <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto">
            <ScenarioCard gates={gates} />
            <LegendCard />
            <Card size="sm">
              <CardContent>
                <Tabs defaultValue="events">
                  <TabsList className="w-full">
                    <TabsTrigger value="events">Events</TabsTrigger>
                    <TabsTrigger value="approvals">Approvals</TabsTrigger>
                    <TabsTrigger value="ledger">Ledger</TabsTrigger>
                  </TabsList>
                  <TabsContent value="events"><EmptyState level="Level 1" title="No events yet" body="Route decisions and closures show up here as they happen." /></TabsContent>
                  <TabsContent value="approvals"><EmptyState level="Level 2" title="Nothing waiting" body="Routes that need a human decision queue here for approval." /></TabsContent>
                  <TabsContent value="ledger"><EmptyState level="Level 2" title="Ledger is empty" body="Every decision is recorded here, in order, and can be replayed." /></TabsContent>
                </Tabs>
              </CardContent>
            </Card>
            <Card size="sm">
              <CardContent>
                <EmptyState level="Level 1" title="Closures" body="Click the map to drop a closure and watch the controller reroute." />
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </TooltipProvider>
  );
}
