import { describe, it, expect } from "vitest";
import type { LedgerEntry, LedgerEvent } from "@contract/types";
import { appendEntry, reloadEntries, filterEntries, isDenied, tail } from "./ledgerFeed";

const e = (n: number, event: LedgerEvent = "vehicle.spawned", over: Partial<LedgerEntry> = {}): LedgerEntry => ({
  _id: `R-1-L${n}`, run_id: "R-1", n, ts: "2026-01-01T00:00:00Z", actor: "supervisor-1", event,
  ref: { collection: "x", id: "y" }, summary: `entry ${n}`, ...over,
});

describe("ledger feed", () => {
  it("keeps appended entries ordered by n, whatever order they arrive in", () => {
    const list = [e(3), e(1), e(2)].reduce(appendEntry, [] as LedgerEntry[]);
    expect(list.map((x) => x.n)).toEqual([1, 2, 3]);
  });

  it("ignores an entry whose n is already there", () => {
    const once = appendEntry([], e(1));
    expect(appendEntry(once, e(1))).toHaveLength(1);
  });

  it("reload replaces the list with the fetched run and drops duplicates", () => {
    const list = reloadEntries([e(1, "vehicle.spawned", { run_id: "R-0" })], [e(2), e(1), e(2)], "R-1");
    expect(list.map((x) => [x.run_id, x.n])).toEqual([["R-1", 1], ["R-1", 2]]);
  });

  it("reload keeps entries that arrived live during the fetch", () => {
    const list = reloadEntries([e(3)], [e(1), e(2)], "R-1");
    expect(list.map((x) => x.n)).toEqual([1, 2, 3]);
  });

  it("filters by group; no group means everything", () => {
    const list = [e(1, "vehicle.spawned"), e(2, "action.decided"), e(3, "zone.created"), e(4, "run.halted"), e(5, "route.replanned")];
    expect(filterEntries(list, []).length).toBe(5);
    expect(filterEntries(list, ["decisions"]).map((x) => x.n)).toEqual([2, 5]);
    expect(filterEntries(list, ["closures"]).map((x) => x.n)).toEqual([3]);
    expect(filterEntries(list, ["run"]).map((x) => x.n)).toEqual([4]);
    expect(filterEntries(list, ["closures", "run"]).map((x) => x.n)).toEqual([3, 4]);
  });

  it("tail returns the latest entries, newest last", () => {
    expect(tail([e(1), e(2), e(3)], 2).map((x) => x.n)).toEqual([2, 3]);
  });

  it("recognises a denied decision from Brain's summary line", () => {
    expect(isDenied(e(1, "action.decided", { summary: "A-9 AC1 to Gate 5 via A: DENY [p-occupied] taken" }))).toBe(true);
    expect(isDenied(e(1, "action.decided", { summary: "A-9 AC1 to Gate 5 via A: ALLOW [p] ok" }))).toBe(false);
    expect(isDenied(e(1, "zone.created", { summary: "DENY" }))).toBe(false);
  });
});
