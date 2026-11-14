import { useEffect, useRef, useState } from "react";
import type { LedgerEntry, LedgerEvent } from "@contract/types";
import { filterEntries, isDenied, tail, type LedgerGroup } from "../lib/ledgerFeed";
import { store, useSelector } from "../state/store";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { EmptyState } from "./Panels";

const CHIP: Record<LedgerEvent, string> = {
  "vehicle.spawned": "bg-slate-100 text-slate-700",
  "action.decided": "bg-blue-100 text-blue-800",
  "approval.resolved": "bg-amber-100 text-amber-800",
  "route.replanned": "bg-indigo-100 text-indigo-800",
  "zone.created": "bg-red-100 text-red-800",
  "zone.expired": "bg-red-50 text-red-700",
  "zone.removed": "bg-red-50 text-red-700",
  "run.halted": "bg-red-600 text-white",
  "run.resumed": "bg-emerald-100 text-emerald-800",
};

const GROUPS: { id: LedgerGroup; label: string }[] = [
  { id: "decisions", label: "Decisions" }, { id: "closures", label: "Closures" }, { id: "run", label: "Run control" },
];

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour12: false });

function Row({ entry, highlighted }: { entry: LedgerEntry; highlighted: boolean }) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => { if (highlighted) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [highlighted]);
  const denied = isDenied(entry);
  return (
    <li ref={ref} data-testid="feed-row" data-denied={denied || undefined} data-highlighted={highlighted || undefined}
      className={cn("flex flex-col gap-1 rounded-md border px-2.5 py-1.5 text-sm", denied && "border-red-300 bg-red-50", highlighted && "row-flash ring-2 ring-[var(--map-pending)]")}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-mono">{time(entry.ts)}</span>
        <span>{entry.actor}</span>
        <Badge variant="outline" className={cn("border-transparent", denied ? "bg-red-600 text-white" : CHIP[entry.event])}>{entry.event}</Badge>
        <span className="ml-auto font-mono">#{entry.n}</span>
      </div>
      <p className={cn(denied && "text-red-900")}>{entry.summary}</p>
    </li>
  );
}

/** One feed from the ledger. Events is the live tail; Ledger is the whole run with filters. */
export function Feed({ mode }: { mode: "events" | "ledger" }) {
  const ledger = useSelector((s) => s.ledger);
  const highlightedAction = useSelector((s) => s.highlightedAction);
  const [groups, setGroups] = useState<LedgerGroup[]>([]);
  const listRef = useRef<HTMLUListElement>(null);

  // "Show in feed" must never be hidden by a filter.
  useEffect(() => { if (highlightedAction && mode === "ledger") setGroups([]); }, [highlightedAction, mode]);
  useEffect(() => {
    if (!highlightedAction) return;
    const t = setTimeout(() => store.clearFeedHighlight(), 4000);
    return () => clearTimeout(t);
  }, [highlightedAction]);
  useEffect(() => { if (mode === "events" && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [ledger, mode]);

  const rows = mode === "events" ? tail(ledger, 20) : filterEntries(ledger, groups);
  const toggle = (g: LedgerGroup) => setGroups((cur) => (cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g]));

  return (
    <div className="flex flex-col gap-2">
      {mode === "ledger" && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter the ledger">
          {GROUPS.map((g) => (
            <button key={g.id} type="button" aria-pressed={groups.includes(g.id)} onClick={() => toggle(g.id)}
              className={cn("rounded-full border px-2.5 py-0.5 text-xs transition-colors", groups.includes(g.id) ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted")}>
              {g.label}
            </button>
          ))}
        </div>
      )}
      {!rows.length ? (
        mode === "events"
          ? <EmptyState title="No events yet" body="Route decisions, closures and run changes show up here as they happen." />
          : <EmptyState title={ledger.length ? "Nothing matches these filters" : "Ledger is empty"} body={ledger.length ? "Clear a filter to see the rest of the run." : "Every decision and change in this run is recorded here, in order."} />
      ) : (
        <ul ref={listRef} className="flex max-h-96 flex-col gap-1.5 overflow-y-auto" data-testid={`${mode}-list`}>
          {rows.map((e) => <Row key={e._id} entry={e} highlighted={mode === "ledger" && e.event === "action.decided" && e.ref.id === highlightedAction} />)}
        </ul>
      )}
    </div>
  );
}
