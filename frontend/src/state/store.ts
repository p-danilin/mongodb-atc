import { useSyncExternalStore } from "react";
import type { Action, LedgerEntry, Snapshot, WsMessage } from "@contract/types";
import type { ConnectionStatus } from "../lib/sync";
import { appendEntry, reloadEntries } from "../lib/ledgerFeed";
import { applyMessage, applySnapshot, initialState, type AppState } from "./reducer";

export type Tab = "events" | "approvals" | "ledger";

export interface StoreState extends AppState {
  connection: ConnectionStatus;
  /** The current run's ledger, ordered by `n`. Fed by the ledger fetch and `ledger.appended` only. */
  ledger: LedgerEntry[];
  // UI-only state below: never sent to or read from Brain.
  /** The queue row (action id) the pointer or keyboard is on; the map brightens its route. */
  highlightedApproval: string | null;
  dropMode: boolean;
  ttlSeconds: number;
  selectedZone: string | null;
  tab: Tab;
  /** Set only by the Red team button; routine denials never set it. */
  redTeamAlert: Action | null;
  /** Ledger row (action id) to scroll to and highlight after "Show in feed". */
  highlightedAction: string | null;
}

type Listener = () => void;
type MessageListener = (m: WsMessage) => void;

/** Tiny external store. Vehicle motion subscribes directly; React reads slices through `useSelector`. */
export function createStore() {
  let state: StoreState = {
    ...initialState, connection: "disconnected", ledger: [], highlightedApproval: null,
    dropMode: false, ttlSeconds: 60, selectedZone: null, tab: "events", redTeamAlert: null, highlightedAction: null,
  };
  const listeners = new Set<Listener>();
  const messageListeners = new Set<MessageListener>();
  const set = (next: StoreState) => { state = next; listeners.forEach((l) => l()); };
  const patch = (p: Partial<StoreState>) => set({ ...state, ...p });
  const dropGoneZone = (next: StoreState): StoreState =>
    next.selectedZone && !next.zones.some((z) => z._id === next.selectedZone) ? { ...next, selectedZone: null } : next;

  return {
    getState: () => state,
    subscribe: (l: Listener) => { listeners.add(l); return () => { listeners.delete(l); }; },
    /** Every websocket message, after it has been applied. Used for one-off effects such as the denial flash. */
    onMessage: (l: MessageListener) => { messageListeners.add(l); return () => { messageListeners.delete(l); }; },
    snapshot: (s: Snapshot) =>
      set(dropGoneZone({ ...state, ...applySnapshot(state, s), ledger: state.ledger.filter((e) => e.run_id === s.run._id) })),
    message: (m: WsMessage) => {
      let next: StoreState = { ...state, ...applyMessage(state, m) };
      if (m.type === "ledger.appended" && m.data.run_id === state.run._id) next = { ...next, ledger: appendEntry(state.ledger, m.data) };
      if (m.type === "sim.reset") next = { ...next, ledger: [], redTeamAlert: null, highlightedAction: null, selectedZone: null };
      set(dropGoneZone(next));
      messageListeners.forEach((l) => l(m));
    },
    loadLedger: (entries: LedgerEntry[], runId: string) => patch({ ledger: reloadEntries(state.ledger, entries, runId) }),
    setConnection: (connection: ConnectionStatus) => patch({ connection }),
    highlightApproval: (id: string | null) => { if (state.highlightedApproval !== id) patch({ highlightedApproval: id }); },
    setDropMode: (dropMode: boolean) => patch({ dropMode, selectedZone: dropMode ? null : state.selectedZone }),
    setTtl: (ttlSeconds: number) => patch({ ttlSeconds }),
    selectZone: (selectedZone: string | null) => patch({ selectedZone }),
    setTab: (tab: Tab) => patch({ tab }),
    setRedTeamAlert: (redTeamAlert: Action | null) => patch({ redTeamAlert }),
    showInFeed: (action: string) => patch({ tab: "ledger", highlightedAction: action }),
    clearFeedHighlight: () => patch({ highlightedAction: null }),
  };
}
export type Store = ReturnType<typeof createStore>;
export const store = createStore();

/** Re-renders only when `select(state)` changes under `equal` (default Object.is). */
export function useSelector<T>(select: (s: StoreState) => T, equal: (a: T, b: T) => boolean = Object.is): T {
  let last: { v: T } | undefined;
  const get = () => {
    const v = select(store.getState());
    if (last && equal(last.v, v)) return last.v;
    last = { v };
    return v;
  };
  return useSyncExternalStore(store.subscribe, get, get);
}
