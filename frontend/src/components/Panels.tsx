import { useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { useSelector } from "../state/store";
import type { ConnectionStatus } from "../lib/sync";

export function Panel({ title, level, children }: { title: string; level?: string; children: ReactNode }) {
  return (
    <section className="panel">
      <header><h2>{title}</h2>{level && <span className="badge">{level}</span>}</header>
      {children}
    </section>
  );
}

export function Placeholder({ text }: { text: string }) {
  return <p className="placeholder">{text}</p>;
}

export function ConnectionIndicator() {
  const c: ConnectionStatus = useSelector((s) => s.connection);
  return <span className={`conn conn-${c}`} data-testid="connection"><i />{c}</span>;
}

export function RunStatus() {
  const status = useSelector((s) => s.run.status);
  return <span className={`run run-${status}`} data-testid="run-status">Run: {status}</span>;
}

export function ScenarioControls({ gates }: { gates: { id: string; name: string }[] }) {
  const [gate, setGate] = useState(gates[0]?.id ?? "G1");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setMsg(null);
    try { await fn(); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Panel title="Scenario" level="Level 0">
      <div className="row">
        <label>Gate{" "}
          <select value={gate} onChange={(e) => setGate(e.target.value)}>
            {gates.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </label>
        <button disabled={busy} onClick={() => act(() => api.spawnFlight({ gate }))}>Spawn flight</button>
        <button disabled={busy} className="secondary" onClick={() => act(api.reset)}>Reset scenario</button>
      </div>
      {msg && <p className="error" role="alert">{msg}</p>}
    </Panel>
  );
}

export function RunControls() {
  return (
    <Panel title="Run controls" level="Level 2">
      <div className="row">
        <button disabled title="Kill switch arrives at Level 2">Halt</button>
        <button disabled title="Kill switch arrives at Level 2">Resume</button>
      </div>
      <Placeholder text="Halt and Resume are disabled until Level 2 (kill switch)." />
    </Panel>
  );
}
