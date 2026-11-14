import type { LedgerEntry, LedgerEvent, RunId } from "@contract/types";

export type LedgerGroup = "decisions" | "closures" | "run";

const GROUP_EVENTS: Record<LedgerGroup, LedgerEvent[]> = {
  decisions: ["action.decided", "approval.resolved", "route.replanned"],
  closures: ["zone.created", "zone.expired", "zone.removed"],
  run: ["run.halted", "run.resumed"],
};

const byN = (a: LedgerEntry, b: LedgerEntry) => a.n - b.n;

function dedupe(list: LedgerEntry[]): LedgerEntry[] {
  const seen = new Set<number>();
  return list.filter((x) => (seen.has(x.n) ? false : (seen.add(x.n), true))).sort(byN);
}

/** Adds one `ledger.appended` entry. Ordered by `n`, duplicates ignored. */
export function appendEntry(list: LedgerEntry[], entry: LedgerEntry): LedgerEntry[] {
  return list.some((x) => x.n === entry.n) ? list : [...list, entry].sort(byN);
}

/** Loads a fetched ledger for `runId`. Entries of other runs are dropped; live entries of this run that the fetch missed are kept. */
export function reloadEntries(current: LedgerEntry[], fetched: LedgerEntry[], runId: RunId): LedgerEntry[] {
  return dedupe([...fetched, ...current].filter((x) => x.run_id === runId));
}

/** No groups selected means no filter. */
export function filterEntries(list: LedgerEntry[], groups: LedgerGroup[]): LedgerEntry[] {
  if (!groups.length) return list;
  const events = new Set(groups.flatMap((g) => GROUP_EVENTS[g]));
  return list.filter((x) => events.has(x.event));
}

export const tail = (list: LedgerEntry[], count: number) => list.slice(-count);

/** Brain's decision summary reads "...: DENY [policy] reason". There is no structured field for it yet. */
export const isDenied = (e: LedgerEntry) => e.event === "action.decided" && /: DENY \[/.test(e.summary);
