import { Debouncer } from "@tanstack/react-pacer";
import { create } from "zustand";

import {
  closeThreadTabs,
  DEFAULT_SPLIT_RATIO,
  EMPTY_THREAD_TABS,
  moveThreadTab,
  sanitizeSplitRatio,
  sanitizeThreadTabsState,
  showThreadTabInSplit,
  takeClosedThreadTab,
  type ThreadTab,
  type ThreadTabsState,
  type ThreadTabTarget,
  visitThreadTab,
} from "./threadTabs.logic";

const PERSISTED_STATE_KEY = "t3code:thread-tabs:v1";

export type ThreadPane = "primary" | "secondary";

interface PersistedState extends ThreadTabsState {
  readonly splitRatio: number;
}

function readPersistedState(): PersistedState {
  const empty = { ...EMPTY_THREAD_TABS, splitRatio: DEFAULT_SPLIT_RATIO };
  if (typeof window === "undefined") return empty;
  try {
    const raw = window.localStorage.getItem(PERSISTED_STATE_KEY);
    if (!raw) return empty;
    const parsed: unknown = JSON.parse(raw);
    return {
      ...sanitizeThreadTabsState(parsed),
      splitRatio: sanitizeSplitRatio(
        parsed && typeof parsed === "object"
          ? (parsed as { splitRatio?: unknown }).splitRatio
          : null,
      ),
    };
  } catch {
    return empty;
  }
}

function persistState(state: PersistedState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      PERSISTED_STATE_KEY,
      JSON.stringify({
        tabs: state.tabs,
        recent: state.recent,
        closed: state.closed,
        split: state.split,
        splitRatio: state.splitRatio,
      } satisfies PersistedState),
    );
  } catch {}
}

const debouncedPersistState = new Debouncer(persistState, { wait: 500 });

interface ThreadTabsStore extends PersistedState {
  /** The pane that last held focus; tab commands act on it while the split shows. */
  readonly focusedPane: ThreadPane;
  /** The tab the second pane is rendering right now; null while no split shows. */
  readonly shownSplit: string | null;
  visit: (target: ThreadTabTarget, previousKey: string | null) => void;
  /** Returns the tab to show when the shown one closed; see `closeThreadTabs`. */
  close: (
    keys: readonly string[],
    shownKeys: readonly string[],
    activeKey: string | null,
  ) => ThreadTab | null | undefined;
  takeClosed: (canOpen: (tab: ThreadTab) => boolean) => ThreadTab | null;
  move: (activeKey: string, overKey: string) => void;
  showInSplit: (key: string) => void;
  closeSplit: () => void;
  setSplitRatio: (ratio: number) => void;
  focusPane: (pane: ThreadPane) => void;
  setShownSplit: (key: string | null) => void;
}

export const useThreadTabsStore = create<ThreadTabsStore>((set, get) => ({
  ...readPersistedState(),
  focusedPane: "primary",
  shownSplit: null,
  visit: (target, previousKey) => set((state) => visitThreadTab(state, target, previousKey)),
  close: (keys, shownKeys, activeKey) => {
    const result = closeThreadTabs(get(), keys, shownKeys, activeKey);
    set(result.state.split === null ? { ...result.state, focusedPane: "primary" } : result.state);
    return result.next;
  },
  takeClosed: (canOpen) => {
    const result = takeClosedThreadTab(get(), canOpen);
    set(result.state);
    return result.tab;
  },
  move: (activeKey, overKey) => set((state) => moveThreadTab(state, activeKey, overKey)),
  showInSplit: (key) => set((state) => showThreadTabInSplit(state, key)),
  closeSplit: () => set({ split: null, focusedPane: "primary" }),
  setSplitRatio: (splitRatio) => set({ splitRatio: sanitizeSplitRatio(splitRatio) }),
  focusPane: (focusedPane) => {
    if (get().focusedPane !== focusedPane) set({ focusedPane });
  },
  setShownSplit: (shownSplit) => {
    if (get().shownSplit !== shownSplit) set({ shownSplit });
  },
}));

let persisted: PersistedState | null = null;
useThreadTabsStore.subscribe((state) => {
  // Focus and the rendered pane change often and are not persisted.
  if (
    persisted !== null &&
    persisted.tabs === state.tabs &&
    persisted.recent === state.recent &&
    persisted.closed === state.closed &&
    persisted.split === state.split &&
    persisted.splitRatio === state.splitRatio
  ) {
    return;
  }
  persisted = state;
  debouncedPersistState.maybeExecute(state);
});

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("beforeunload", () => {
    debouncedPersistState.flush();
  });
}
