import { useEffect, useState } from "react";
import type { Graph } from "@contract/types";
import { api, browserTransport } from "./lib/api";
import { createSync } from "./lib/sync";
import { store, useSelector } from "./state/store";
import { AirportMap } from "./components/AirportMap";
import { ConnectionIndicator, Panel, Placeholder, RunControls, RunStatus, ScenarioControls } from "./components/Panels";

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
    <div className="app">
      <header className="topbar">
        <h1>Ground Control · Tower</h1>
        <div className="status"><RunStatus /><ConnectionIndicator /></div>
      </header>
      <main className="map-area">
        {error && <p className="error" role="alert">Cannot load the airport graph: {error}</p>}
        {!error && !(graph && ready) && <p className="placeholder">Loading airport…</p>}
        {graph && ready && <AirportMap graph={graph} />}
      </main>
      <aside className="side">
        <ScenarioControls gates={gates} />
        <RunControls />
        <Panel title="Event feed" level="Level 1"><Placeholder text="Live decisions and events will appear here at Level 1." /></Panel>
        <Panel title="Approval queue" level="Level 2"><Placeholder text="Actions waiting for a human will appear here at Level 2." /></Panel>
        <Panel title="Ledger" level="Level 2"><Placeholder text="The append-only ledger and replay will appear here at Level 2." /></Panel>
        <Panel title="Zone drawing" level="Level 1"><Placeholder text="Click the map to drop a closure at Level 1." /></Panel>
      </aside>
    </div>
  );
}
