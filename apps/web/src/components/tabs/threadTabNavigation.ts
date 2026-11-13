import type { AnyRouter } from "@tanstack/react-router";

import { useComposerDraftStore } from "../../composerDraftStore";
import { useThreadRouteTarget } from "../../hooks/useThreadRouteTarget";
import type { ThreadTab } from "../../threadTabs.logic";
import { useThreadTabsStore } from "../../threadTabsStore";
import { resolveThreadRouteTarget, type ThreadRouteTarget } from "../../threadRoutes";
import { isAppModalPage } from "../sidebar/mainAppLocation";

const CHAT_ROUTE_ID = "/_chat";

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

export function navigateToThreadTab(router: AnyRouter, tab: ThreadTab): Promise<void> {
  return tab.target.kind === "thread"
    ? router.navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId: tab.target.environmentId, threadId: tab.target.threadId },
      })
    : router.navigate({ to: "/draft/$draftId", params: { draftId: tab.target.draftId } });
}

/** Closes tabs, and shows the neighbour, or Home after the last, when the shown one closed. */
export function closeThreadTabsAndNavigate(
  router: AnyRouter,
  keys: readonly string[],
  shownKeys: readonly string[],
): void {
  const next = useThreadTabsStore.getState().close(keys, shownKeys, readActiveThreadTabKey(router));
  if (next === undefined) return;
  void (next === null ? router.navigate({ to: "/home" }) : navigateToThreadTab(router, next));
}

/** Every thread or draft the route shows opens, or brings forward, its tab. */
export function startThreadTabTracking(router: AnyRouter): void {
  router.subscribe("onResolved", () => {
    const target = readRouteTarget(router);
    if (target === null) return;
    if (target.kind === "server") {
      useThreadTabsStore.getState().visit({
        kind: "thread",
        environmentId: target.threadRef.environmentId,
        threadId: target.threadRef.threadId,
      });
      return;
    }
    const draft = useComposerDraftStore.getState().getDraftSession(target.draftId);
    if (!draft) return;
    useThreadTabsStore
      .getState()
      .visit({ kind: "draft", draftId: target.draftId, threadId: draft.threadId });
  });
}
