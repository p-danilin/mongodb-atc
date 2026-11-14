import { useCallback, useEffect, useRef, useState } from "react";
import type { Graph } from "@contract/types";
import { api, browserTransport } from "./lib/api";
import { createSync } from "./lib/sync";
import { store, useSelector, type Tab } from "./state/store";
import { AirportMap } from "./components/AirportMap";
import { ApprovalQueue, PendingCount } from "./components/ApprovalQueue";
import { Feed } from "./components/Feed";
import { RadioCaptions, ScenarioCard } from "./components/Panels";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";

export default function App() {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ready = useSelector((s) => s.ready);
  const tab = useSelector((s) => s.tab);
  const [radio, setRadio] = useState<{ id: number; who: "Pilot" | "Ground" | "System"; text: string }[]>([]);
  const nextLine = useRef(1);
  const [speaking, setSpeaking] = useState<number | null>(null);
  const onLine = useCallback((who: "Pilot" | "Ground", text: string) => {
    const id = nextLine.current++;
    setRadio((l) => [...l.slice(-5), { id, who, text }]);
    setSpeaking(id);
  }, []);
  const onEnd = useCallback(() => setSpeaking(null), []);

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
      <div className="grid h-full min-h-0 gap-4 p-4 max-lg:grid-rows-[60vh_auto] lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-[minmax(0,1fr)]">
        <main className="relative min-h-0 overflow-hidden rounded-xl border bg-map-ground">
          {error && <p role="alert" className="p-4 text-sm text-destructive">Cannot load the airport graph: {error}. Check that the server at VITE_API_URL is running.</p>}
          {!error && !(graph && ready) && <p className="p-4 text-sm text-muted-foreground">Loading airport…</p>}
          {graph && ready && <AirportMap graph={graph} />}
          <h1 className="pointer-events-none absolute left-4 top-3 z-20 text-2xl font-semibold tracking-tight">Wilco</h1>
        </main>
        <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto [&>*]:shrink-0">
          <ScenarioCard gates={gates} onLine={onLine} onEnd={onEnd} />
          <Card size="sm">
            <CardContent>
              <Tabs value={tab === "ledger" ? "ledger" : "approvals"} onValueChange={(v) => store.setTab(v as Tab)}>
                <TabsList className="w-full">
                  <TabsTrigger value="approvals">Approvals<PendingCount /></TabsTrigger>
                  <TabsTrigger value="ledger">Ledger</TabsTrigger>
                </TabsList>
                <TabsContent value="approvals"><ApprovalQueue gateNames={gateNames} /></TabsContent>
                <TabsContent value="ledger"><Feed mode="ledger" /></TabsContent>
              </Tabs>
            </CardContent>
          </Card>
          <RadioCaptions lines={radio} speaking={speaking} />
        </aside>
      </div>
    </TooltipProvider>
  );
}
