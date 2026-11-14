import { useSyncExternalStore } from "react";
import type { Snapshot, WsMessage } from "@contract/types";
import type { ConnectionStatus } from "../lib/sync";
import { applyMessage, applySnapshot, initialState, type AppState } from "./reducer";

export interface StoreState extends AppState { connection: ConnectionStatus }

type Listener = () => void;

/** Tiny external store. Vehicle motion subscribes directly; React reads slices through `useSelector`. */
export function createStore() {
  let state: StoreState = { ...initialState, connection: "disconnected" };
  const listeners = new Set<Listener>();
  const set = (next: StoreState) => { state = next; listeners.forEach((l) => l()); };
  return {
    getState: () => state,
    subscribe: (l: Listener) => { listeners.add(l); return () => { listeners.delete(l); }; },
    snapshot: (s: Snapshot) => set({ ...applySnapshot(state, s), connection: state.connection }),
    message: (m: WsMessage) => set({ ...applyMessage(state, m), connection: state.connection }),
    setConnection: (connection: ConnectionStatus) => set({ ...state, connection }),
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
