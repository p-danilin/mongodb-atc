import { useEffect, useState } from "react";
import { CrosshairIcon, Trash2Icon } from "lucide-react";
import { api } from "../lib/api";
import { store, useSelector } from "../state/store";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const TTLS = [{ v: 30, label: "30 seconds" }, { v: 60, label: "1 minute" }, { v: 300, label: "5 minutes" }];

/** Top-left of the map: the Drop closure toggle, its lifetime, and removal of the selected closure. */
export function ClosureControls({ message, clearMessage }: { message: string | null; clearMessage: () => void }) {
  const dropMode = useSelector((s) => s.dropMode);
  const ttl = useSelector((s) => s.ttlSeconds);
  const selected = useSelector((s) => s.selectedZone);
  const halted = useSelector((s) => s.run.status === "halted");
  const [removeError, setRemoveError] = useState<string | null>(null);

  useEffect(() => {
    if (!dropMode) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") store.setDropMode(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dropMode]);

  const remove = async () => {
    if (!selected) return;
    setRemoveError(null);
    try { await api.removeZone(selected); store.selectZone(null); } catch (e) { setRemoveError((e as Error).message); }
  };
  const error = message ?? removeError;

  return (
    <div className={`absolute left-3 ${halted ? "top-14" : "top-3"} flex max-w-[calc(100%-1.5rem)] flex-col items-start gap-2`}>
      <div className="flex items-center gap-2 rounded-lg border bg-card/95 p-1.5 shadow-sm">
        <Button size="sm" variant={dropMode ? "default" : "outline"} aria-pressed={dropMode}
          onClick={() => { clearMessage(); setRemoveError(null); store.setDropMode(!dropMode); }}>
          <CrosshairIcon data-icon="inline-start" />Drop closure{dropMode ? ": click the map" : ""}
        </Button>
        <Select value={String(ttl)} onValueChange={(v) => store.setTtl(Number(v))}>
          <SelectTrigger size="sm" className="w-32" aria-label="Closure lasts"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup>{TTLS.map((t) => <SelectItem key={t.v} value={String(t.v)}>{t.label}</SelectItem>)}</SelectGroup></SelectContent>
        </Select>
      </div>
      {selected && (
        <Button size="sm" variant="destructive" onClick={remove}><Trash2Icon data-icon="inline-start" />Remove closure {selected}</Button>
      )}
      {error && <p role="alert" className="rounded-md border border-destructive/40 bg-card px-2 py-1 text-sm text-destructive shadow-sm">{error}</p>}
    </div>
  );
}

function clock(iso?: string) {
  return iso ? new Date(iso).toLocaleTimeString([], { hour12: false }) : "";
}

/** Full-width red banner while the run is halted. */
export function HaltBanner() {
  const run = useSelector((s) => s.run, (a, b) => a === b);
  if (run.status !== "halted") return null;
  return (
    <div role="status" data-testid="halt-banner" className="absolute inset-x-0 top-0 z-10 bg-destructive px-4 py-2 text-center text-sm font-medium text-white shadow">
      Run halted by {run.halted_by ?? "supervisor"}{run.halted_at ? ` at ${clock(run.halted_at)}` : ""}
    </div>
  );
}
