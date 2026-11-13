import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { AnyRouter } from "@tanstack/react-router";

import { useComposerDraftStore } from "../../composerDraftStore";
import { useThreadRouteTarget } from "../../hooks/useThreadRouteTarget";
import { requestWorkspaceFocus } from "../../lib/workspaceFocus";
import { mostRecentThreadTab, type ThreadTab } from "../../threadTabs.logic";
import { type ThreadPane, useThreadTabsStore } from "../../threadTabsStore";
import { resolveThreadRouteTarget, type ThreadRouteTarget } from "../../threadRoutes";
import { isAppModalPage } from "../sidebar/mainAppLocation";
import { toastManager } from "../ui/toast";

const CHAT_ROUTE_ID = "/_chat";

/** Two panes need about two composers' width; narrower windows keep the split but hide it. */
export const SPLIT_VIEW_MEDIA_QUERY = "(min-width: 1024px)";

/** The second pane's workspace areas, after the main pane's in the F6 cycle. */
export const SPLIT_CONVERSATION_AREA = "split-conversation";
export const SPLIT_COMPOSER_AREA = "split-composer";

/** What the split view's second pane gives its chat. */
export interface SecondaryPaneHost {
  /** Moves the pane's thread to the main pane, where its right panel and terminal show. */
  readonly promote: () => void;
}

interface PaneTab {
  readonly key: string;
  readonly tab: ThreadTab;
}

function routeTabKey(target: ThreadRouteTarget | null): string | null {
  if (target === null) return null;
  return target.kind === "server"
    ? `${target.threadRef.environmentId}:${target.threadRef.threadId}`
    : `draft:${target.draftId}`;
}

/** The tab the route shows. Settings and Usage cover the route, so they show none. */
export function useActiveThreadTabKey(): string | null {
  return routeTabKey(useThreadRouteTarget());
}

function readRouteTarget(router: AnyRouter): ThreadRouteTarget | null {
  const { matches } = router.state;
  if (!matches.some((match) => match.routeId === CHAT_ROUTE_ID)) return null;
  if (matches.some((match) => isAppModalPage(match.pathname))) return null;
  return resolveThreadRouteTarget(matches.at(-1)?.params ?? {});
}

export function readActiveThreadTabKey(router: AnyRouter): string | null {
  return routeTabKey(readRouteTarget(router));
}

/** The pane keyboard commands act on: the second one only while it shows and last had focus. */
export function readFocusedPane(): ThreadPane {
  const { shownSplit, focusedPane } = useThreadTabsStore.getState();
  return shownSplit !== null && focusedPane === "secondary" ? "secondary" : "primary";
}

/** The second pane's thread while it shows and has focus; null when the main pane has it. */
export function useFocusedSplitThreadRef(): ScopedThreadRef | null {
  const key = useThreadTabsStore((state) =>
    state.focusedPane === "secondary" ? state.shownSplit : null,
  );
  return key === null ? null : parseScopedThreadKey(key);
}

/** The focused pane's thread or draft; see `readFocusedPane`. */
export function readFocusedThreadRouteTarget(router: AnyRouter): ThreadRouteTarget | null {
  const key = readFocusedPane() === "secondary" ? useThreadTabsStore.getState().shownSplit : null;
  const threadRef = key === null ? null : parseScopedThreadKey(key);
  return threadRef === null ? readRouteTarget(router) : { kind: "server", threadRef };
}

/** Where focus goes once the route settles; navigation the second pane asks for can keep it. */
let routeFocusPane: ThreadPane = "primary";

export function navigateToThreadTab(
  router: AnyRouter,
  tab: ThreadTab,
  focusPane: ThreadPane = "primary",
): Promise<void> {
  if (tab.key !== readActiveThreadTabKey(router)) routeFocusPane = focusPane;
  return tab.target.kind === "thread"
    ? router.navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId: tab.target.environmentId, threadId: tab.target.threadId },
      })
    : router.navigate({ to: "/draft/$draftId", params: { draftId: tab.target.draftId } });
}

/**
 * Closes tabs in either pane. When the main pane's tab closed, shows its neighbour, the second
 * pane's tab, or Home after the last.
 */
export function closeThreadTabsAndNavigate(
  router: AnyRouter,
  keys: readonly string[],
  shownKeys: readonly string[],
): void {
  const next = useThreadTabsStore.getState().close(keys, shownKeys, readActiveThreadTabKey(router));
  if (next === undefined) return;
  void (next === null ? router.navigate({ to: "/home" }) : navigateToThreadTab(router, next));
}

function splitTab(): ThreadTab | null {
  const { shownSplit, tabs } = useThreadTabsStore.getState();
  return shownSplit === null ? null : (tabs.find((tab) => tab.key === shownSplit) ?? null);
}

/** Moves the second pane's thread to the main pane; the main pane's thread swaps in beside it. */
export function swapThreadPanes(router: AnyRouter, focusPane: ThreadPane = "primary"): boolean {
  const tab = splitTab();
  if (tab === null) return false;
  void navigateToThreadTab(router, tab, focusPane);
  return true;
}

/**
 * Shows a tab in a pane. A tab the other pane shows swaps the panes; a draft opens in the main
 * pane, where the route promotes it.
 */
export function activateThreadTab(router: AnyRouter, pane: ThreadPane, tab: PaneTab): void {
  const store = useThreadTabsStore.getState();
  const primaryKey = readActiveThreadTabKey(router);
  if (pane === "primary" || tab.tab.target.kind !== "thread") {
    if (tab.key !== primaryKey) void navigateToThreadTab(router, tab.tab);
    return;
  }
  if (tab.key === store.shownSplit) return;
  if (tab.key === primaryKey) {
    swapThreadPanes(router, "secondary");
    return;
  }
  store.showInSplit(tab.key);
  store.focusPane("secondary");
}

function reportSplitUnavailable(): boolean {
  if (typeof window !== "undefined" && window.matchMedia(SPLIT_VIEW_MEDIA_QUERY).matches) {
    return false;
  }
  toastManager.add({ type: "info", title: "Widen the window to show two threads side by side." });
  return true;
}

function reportNothingToSplit() {
  toastManager.add({ type: "info", title: "Open another thread to show beside this one." });
}

/** Opens a thread tab in the second pane. The main pane's own tab moves there. */
export function openThreadTabInSplit(
  router: AnyRouter,
  tab: PaneTab,
  shown: readonly PaneTab[],
): void {
  if (tab.tab.target.kind !== "thread" || reportSplitUnavailable()) return;
  const store = useThreadTabsStore.getState();
  const primaryKey = readActiveThreadTabKey(router);
  if (tab.key !== primaryKey) {
    store.showInSplit(tab.key);
    store.focusPane("secondary");
    return;
  }
  if (swapThreadPanes(router, "secondary")) return;
  const replacement = mostRecentThreadTab(
    store.recent,
    shown.filter((entry) => entry.key !== primaryKey),
  );
  if (replacement === null) {
    reportNothingToSplit();
    return;
  }
  // Only once the route has left it, so the thread is never in both panes.
  void navigateToThreadTab(router, replacement.tab).then(() => {
    useThreadTabsStore.getState().showInSplit(tab.key);
    useThreadTabsStore.getState().focusPane("secondary");
  });
}

/** Opens the split with the most recent other thread, or closes it. */
export function toggleSplitView(router: AnyRouter, shown: readonly PaneTab[]): boolean {
  const store = useThreadTabsStore.getState();
  if (store.shownSplit !== null) {
    store.closeSplit();
    requestWorkspaceFocus({ area: "composer" });
    return true;
  }
  const primaryKey = readActiveThreadTabKey(router);
  if (primaryKey === null) return false;
  if (reportSplitUnavailable()) return true;
  const candidate = mostRecentThreadTab(
    store.recent,
    shown.filter((entry) => entry.key !== primaryKey && entry.tab.target.kind === "thread"),
  );
  if (candidate === null) {
    reportNothingToSplit();
    return true;
  }
  store.showInSplit(candidate.key);
  store.focusPane("secondary");
  return true;
}

/** Moves the focused pane's tab to the other pane, and focus with it. */
export function moveThreadTabToOtherPane(router: AnyRouter, shown: readonly PaneTab[]): boolean {
  if (readFocusedPane() === "secondary") return swapThreadPanes(router, "primary");
  const primaryKey = readActiveThreadTabKey(router);
  const tab = shown.find((entry) => entry.key === primaryKey);
  if (!tab) return false;
  if (tab.tab.target.kind !== "thread") {
    toastManager.add({ type: "info", title: "Send the first message before moving this thread." });
    return true;
  }
  openThreadTabInSplit(router, tab, shown);
  return true;
}

export function focusOtherThreadPane(): boolean {
  if (useThreadTabsStore.getState().shownSplit === null) return false;
  const other = readFocusedPane() === "primary" ? "secondary" : "primary";
  useThreadTabsStore.getState().focusPane(other);
  requestWorkspaceFocus({ area: other === "primary" ? "composer" : SPLIT_COMPOSER_AREA });
  return true;
}

/**
 * Every thread or draft the route shows opens, or brings forward, its tab, and takes focus
 * unless the second pane asked to keep it.
 */
export function startThreadTabTracking(router: AnyRouter): void {
  let lastKey: string | null = null;
  router.subscribe("onResolved", () => {
    const target = readRouteTarget(router);
    const key = routeTabKey(target);
    if (target === null || key === null) return;
    const previousKey = lastKey;
    if (key !== lastKey) {
      lastKey = key;
      useThreadTabsStore.getState().focusPane(routeFocusPane);
    }
    routeFocusPane = "primary";
    if (target.kind === "server") {
      useThreadTabsStore.getState().visit(
        {
          kind: "thread",
          environmentId: target.threadRef.environmentId,
          threadId: target.threadRef.threadId,
        },
        previousKey,
      );
      return;
    }
    const draft = useComposerDraftStore.getState().getDraftSession(target.draftId);
    if (!draft) return;
    useThreadTabsStore
      .getState()
      .visit({ kind: "draft", draftId: target.draftId, threadId: draft.threadId }, previousKey);
  });
}
