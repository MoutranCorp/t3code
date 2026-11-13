/**
 * Browser-style thread tabs. The open list and its order persist. The main pane's active tab is
 * not stored, it is whatever thread the route shows; the split view's second pane keeps its own.
 */
export type ThreadTabTarget =
  | { readonly kind: "thread"; readonly environmentId: string; readonly threadId: string }
  /** An unsent draft; `threadId` is the id its server thread will take. */
  | { readonly kind: "draft"; readonly draftId: string; readonly threadId: string };

export interface ThreadTab {
  readonly key: string;
  readonly target: ThreadTabTarget;
}

export interface ThreadTabsState {
  readonly tabs: readonly ThreadTab[];
  /** Tab keys, most recently active first. */
  readonly recent: readonly string[];
  /** Closed tabs, most recently closed first. */
  readonly closed: readonly ThreadTab[];
  /** The tab the split view's second pane shows; null while the split is closed. */
  readonly split: string | null;
}

export const EMPTY_THREAD_TABS: ThreadTabsState = { tabs: [], recent: [], closed: [], split: null };

export const DEFAULT_SPLIT_RATIO = 0.5;

const MAX_OPEN_TABS = 40;
const MAX_CLOSED_TABS = 20;

function threadTabKey(target: ThreadTabTarget): string {
  return target.kind === "thread"
    ? `${target.environmentId}:${target.threadId}`
    : `draft:${target.draftId}`;
}

function makeTab(target: ThreadTabTarget): ThreadTab {
  return { key: threadTabKey(target), target };
}

/** Only a server thread opens in the second pane: a draft promotes through the route. */
function isSplitKey(key: string): boolean {
  return !key.startsWith("draft:");
}

function canSplit(state: ThreadTabsState, key: string): boolean {
  return state.tabs.some((tab) => tab.key === key && tab.target.kind === "thread");
}

/**
 * The tab the second pane shows. When the main pane moves onto the split's tab, the panes swap:
 * the second pane takes the tab the main pane left, or closes if that tab cannot go there.
 */
export function resolveSplitTabKey(
  split: string | null,
  primaryKey: string | null,
  previousPrimaryKey: string | null,
): string | null {
  if (split === null || split !== primaryKey) return split;
  return previousPrimaryKey !== null &&
    previousPrimaryKey !== primaryKey &&
    isSplitKey(previousPrimaryKey)
    ? previousPrimaryKey
    : null;
}

/**
 * Opens the route's tab, or brings it forward. A sent draft's tab becomes its thread in place.
 * `previousKey` is the tab the route showed before; it swaps into the second pane when the
 * route moves onto the second pane's tab, so a thread is never in both panes.
 */
export function visitThreadTab(
  state: ThreadTabsState,
  target: ThreadTabTarget,
  previousKey: string | null = null,
): ThreadTabsState {
  const next = openThreadTab(state, target);
  const resolved = resolveSplitTabKey(next.split, threadTabKey(target), previousKey);
  const split = resolved !== null && canSplit(next, resolved) ? resolved : null;
  return split === next.split ? next : { ...next, split };
}

function openThreadTab(state: ThreadTabsState, target: ThreadTabTarget): ThreadTabsState {
  const key = threadTabKey(target);
  const recent = [key, ...state.recent.filter((entry) => entry !== key)];
  const closed = state.closed.some((tab) => tab.key === key)
    ? state.closed.filter((tab) => tab.key !== key)
    : state.closed;
  if (state.tabs.some((tab) => tab.key === key)) {
    if (state.recent[0] === key && closed === state.closed) return state;
    return { ...state, recent, closed };
  }
  const promotedIndex =
    target.kind === "thread"
      ? state.tabs.findIndex(
          (tab) => tab.target.kind === "draft" && tab.target.threadId === target.threadId,
        )
      : -1;
  const tab = makeTab(target);
  if (promotedIndex >= 0) {
    const draftKey = state.tabs[promotedIndex]!.key;
    return {
      ...state,
      tabs: state.tabs.map((entry, index) => (index === promotedIndex ? tab : entry)),
      recent: recent.filter((entry) => entry !== draftKey),
      closed,
    };
  }
  let tabs = [...state.tabs, tab];
  let trimmedRecent = recent;
  if (tabs.length > MAX_OPEN_TABS) {
    // The least recently active tabs go first; a tab never visited counts as oldest.
    const rank = new Map(recent.map((entry, index) => [entry, index] as const));
    const dropped = new Set(
      tabs
        .map((entry) => entry.key)
        .toSorted(
          (left, right) =>
            (rank.get(right) ?? Number.POSITIVE_INFINITY) -
            (rank.get(left) ?? Number.POSITIVE_INFINITY),
        )
        .slice(0, tabs.length - MAX_OPEN_TABS),
    );
    tabs = tabs.filter((entry) => !dropped.has(entry.key));
    trimmedRecent = recent.filter((entry) => !dropped.has(entry));
  }
  return { ...state, tabs, recent: trimmedRecent, closed };
}

/** The nearest accepted key right of `fromKey` among `shownKeys`, else left of it. */
function neighbourKey(
  shownKeys: readonly string[],
  fromKey: string,
  accept: (key: string) => boolean,
): string | null {
  const index = shownKeys.indexOf(fromKey);
  const first = (entries: readonly string[]) => entries.find(accept) ?? null;
  return index < 0
    ? first(shownKeys)
    : (first(shownKeys.slice(index + 1)) ?? first(shownKeys.slice(0, index).toReversed()));
}

/**
 * Closes tabs. When the main pane's tab closes, `next` is the tab to show instead: its right
 * neighbour among `shownKeys`, else its left one, else the second pane's tab (closing the
 * split), else null for none. `next` is undefined when the main pane's tab stays open. A
 * closing second pane moves to its own neighbour, or closes.
 */
export function closeThreadTabs(
  state: ThreadTabsState,
  keys: readonly string[],
  shownKeys: readonly string[],
  activeKey: string | null,
): { readonly state: ThreadTabsState; readonly next: ThreadTab | null | undefined } {
  const closing = new Set(keys);
  const closedTabs = state.tabs.filter((tab) => closing.has(tab.key));
  if (closedTabs.length === 0) return { state, next: undefined };
  const stays = (key: string) => !closing.has(key);
  let split = state.split;
  let nextKey: string | null | undefined;
  if (activeKey !== null && closing.has(activeKey)) {
    nextKey = neighbourKey(shownKeys, activeKey, (key) => stays(key) && key !== split);
    if (nextKey === null && split !== null && stays(split)) {
      nextKey = split;
      split = null;
    }
  }
  if (split !== null && closing.has(split)) {
    const primaryKey = nextKey === undefined ? activeKey : nextKey;
    split = neighbourKey(
      shownKeys,
      split,
      (key) => stays(key) && key !== primaryKey && canSplit(state, key),
    );
  }
  return {
    state: {
      tabs: state.tabs.filter((tab) => stays(tab.key)),
      recent: state.recent.filter(stays),
      closed: [...closedTabs.toReversed(), ...state.closed.filter((tab) => stays(tab.key))].slice(
        0,
        MAX_CLOSED_TABS,
      ),
      split,
    },
    next:
      nextKey === undefined || nextKey === null
        ? nextKey
        : (state.tabs.find((tab) => tab.key === nextKey) ?? null),
  };
}

/** Shows a thread tab in the second pane, opening the split. The caller keeps it off the route. */
export function showThreadTabInSplit(state: ThreadTabsState, key: string): ThreadTabsState {
  if (!canSplit(state, key) || (state.split === key && state.recent[0] === key)) return state;
  return { ...state, split: key, recent: [key, ...state.recent.filter((entry) => entry !== key)] };
}

const MIN_SPLIT_RATIO = 0.2;

/** Keeps each pane at least `minPaneWidth` wide inside `width`, or even when both cannot fit. */
export function clampSplitRatio(ratio: number, width: number, minPaneWidth: number): number {
  if (!Number.isFinite(ratio)) return DEFAULT_SPLIT_RATIO;
  const edge =
    width > 2 * minPaneWidth
      ? Math.max(MIN_SPLIT_RATIO, minPaneWidth / width)
      : DEFAULT_SPLIT_RATIO;
  return Math.min(1 - edge, Math.max(edge, ratio));
}

export function sanitizeSplitRatio(value: unknown): number {
  return typeof value === "number" && value >= MIN_SPLIT_RATIO && value <= 1 - MIN_SPLIT_RATIO
    ? value
    : DEFAULT_SPLIT_RATIO;
}

/** Takes the most recently closed tab that can still open; the caller navigates to it. */
export function takeClosedThreadTab(
  state: ThreadTabsState,
  canOpen: (tab: ThreadTab) => boolean,
): { readonly state: ThreadTabsState; readonly tab: ThreadTab | null } {
  const tab = state.closed.find(canOpen) ?? null;
  if (tab === null) return { state, tab };
  return { state: { ...state, closed: state.closed.filter((entry) => entry !== tab) }, tab };
}

/** Moves a dragged tab onto another's slot. */
export function moveThreadTab(
  state: ThreadTabsState,
  activeKey: string,
  overKey: string,
): ThreadTabsState {
  const from = state.tabs.findIndex((tab) => tab.key === activeKey);
  const to = state.tabs.findIndex((tab) => tab.key === overKey);
  if (from < 0 || to < 0 || from === to) return state;
  const tabs = [...state.tabs];
  const [moved] = tabs.splice(from, 1);
  tabs.splice(to, 0, moved!);
  return { ...state, tabs };
}

/** The tab `direction` steps from the shown one, wrapping; the first or last with none shown. */
export function adjacentThreadTab<T extends { readonly key: string }>(
  shown: readonly T[],
  activeKey: string | null,
  direction: 1 | -1,
): T | null {
  if (shown.length === 0) return null;
  const index = activeKey === null ? -1 : shown.findIndex((tab) => tab.key === activeKey);
  if (index < 0) return (direction === 1 ? shown[0] : shown.at(-1)) ?? null;
  return shown[(index + direction + shown.length) % shown.length] ?? null;
}

/** The most recently active of `candidates`. */
export function mostRecentThreadTab<T extends { readonly key: string }>(
  recent: readonly string[],
  candidates: readonly T[],
): T | null {
  const byKey = new Map(candidates.map((tab) => [tab.key, tab] as const));
  for (const key of recent) {
    const tab = byKey.get(key);
    if (tab) return tab;
  }
  return candidates[0] ?? null;
}

function sanitizeTarget(value: unknown): ThreadTabTarget | null {
  if (!value || typeof value !== "object") return null;
  const target = value as Record<string, unknown>;
  const nonEmpty = (field: unknown): field is string =>
    typeof field === "string" && field.length > 0;
  if (target.kind === "thread" && nonEmpty(target.environmentId) && nonEmpty(target.threadId)) {
    return { kind: "thread", environmentId: target.environmentId, threadId: target.threadId };
  }
  if (target.kind === "draft" && nonEmpty(target.draftId) && nonEmpty(target.threadId)) {
    return { kind: "draft", draftId: target.draftId, threadId: target.threadId };
  }
  return null;
}

function sanitizeTabs(value: unknown, limit: number): ThreadTab[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value
    .flatMap((entry: unknown) => {
      const target = sanitizeTarget(
        entry && typeof entry === "object" ? (entry as { target?: unknown }).target : null,
      );
      if (target === null) return [];
      const tab = makeTab(target);
      if (seen.has(tab.key)) return [];
      seen.add(tab.key);
      return [tab];
    })
    .slice(0, limit);
}

export function sanitizeThreadTabsState(value: unknown): ThreadTabsState {
  if (!value || typeof value !== "object") return EMPTY_THREAD_TABS;
  const raw = value as Record<string, unknown>;
  const tabs = sanitizeTabs(raw.tabs, MAX_OPEN_TABS);
  const open = new Set(tabs.map((tab) => tab.key));
  const recent = Array.isArray(raw.recent)
    ? [
        ...new Set(
          raw.recent.filter(
            (entry): entry is string => typeof entry === "string" && open.has(entry),
          ),
        ),
      ]
    : [];
  const split =
    typeof raw.split === "string" &&
    tabs.some((tab) => tab.key === raw.split && tab.target.kind === "thread")
      ? raw.split
      : null;
  return {
    tabs,
    recent,
    closed: sanitizeTabs(raw.closed, MAX_CLOSED_TABS).filter((tab) => !open.has(tab.key)),
    split,
  };
}
