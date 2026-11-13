import { Debouncer } from "@tanstack/react-pacer";
import { create } from "zustand";

import {
  closeThreadTabs,
  EMPTY_THREAD_TABS,
  moveThreadTab,
  sanitizeThreadTabsState,
  takeClosedThreadTab,
  type ThreadTab,
  type ThreadTabsState,
  type ThreadTabTarget,
  visitThreadTab,
} from "./threadTabs.logic";

const PERSISTED_STATE_KEY = "t3code:thread-tabs:v1";

function readPersistedState(): ThreadTabsState {
  if (typeof window === "undefined") return EMPTY_THREAD_TABS;
  try {
    const raw = window.localStorage.getItem(PERSISTED_STATE_KEY);
    return raw ? sanitizeThreadTabsState(JSON.parse(raw)) : EMPTY_THREAD_TABS;
  } catch {
    return EMPTY_THREAD_TABS;
  }
}

function persistState(state: ThreadTabsState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      PERSISTED_STATE_KEY,
      JSON.stringify({
        tabs: state.tabs,
        recent: state.recent,
        closed: state.closed,
      } satisfies ThreadTabsState),
    );
  } catch {}
}

const debouncedPersistState = new Debouncer(persistState, { wait: 500 });

interface ThreadTabsStore extends ThreadTabsState {
  visit: (target: ThreadTabTarget) => void;
  /** Returns the tab to show when the shown one closed; see `closeThreadTabs`. */
  close: (
    keys: readonly string[],
    shownKeys: readonly string[],
    activeKey: string | null,
  ) => ThreadTab | null | undefined;
  takeClosed: (canOpen: (tab: ThreadTab) => boolean) => ThreadTab | null;
  move: (activeKey: string, overKey: string) => void;
}

export const useThreadTabsStore = create<ThreadTabsStore>((set, get) => ({
  ...readPersistedState(),
  visit: (target) => set((state) => visitThreadTab(state, target)),
  close: (keys, shownKeys, activeKey) => {
    const result = closeThreadTabs(get(), keys, shownKeys, activeKey);
    set(result.state);
    return result.next;
  },
  takeClosed: (canOpen) => {
    const result = takeClosedThreadTab(get(), canOpen);
    set(result.state);
    return result.tab;
  },
  move: (activeKey, overKey) => set((state) => moveThreadTab(state, activeKey, overKey)),
}));

useThreadTabsStore.subscribe((state) => debouncedPersistState.maybeExecute(state));

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("beforeunload", () => {
    debouncedPersistState.flush();
  });
}
