import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ScopedProjectRef, ThreadId } from "@t3tools/contracts";
import type { AnyRouter } from "@tanstack/react-router";

import { useComposerDraftStore } from "../../composerDraftStore";
import { readThreadShell } from "../../state/entities";
import { mostRecentThreadTab, type ThreadTab } from "../../threadTabs.logic";
import { useThreadTabsStore } from "../../threadTabsStore";
import { navigateToThreadTab } from "./threadTabNavigation";

interface OpenableProject {
  readonly environmentId: EnvironmentId;
  readonly id: string;
  readonly memberProjectRefs: ReadonlyArray<ScopedProjectRef>;
}

function tabProjectRefKey(tab: ThreadTab): string | null {
  if (tab.target.kind === "draft") {
    const draft = useComposerDraftStore.getState().draftThreadsByThreadKey[tab.target.draftId];
    return draft ? `${draft.environmentId}:${draft.projectId}` : null;
  }
  const shell = readThreadShell(
    scopeThreadRef(tab.target.environmentId as EnvironmentId, tab.target.threadId as ThreadId),
  );
  return shell && shell.archivedAt === null ? `${shell.environmentId}:${shell.projectId}` : null;
}

/** Returns to the project's most recently active open tab, else its project screen. */
export function openProjectFromTabs(router: AnyRouter, project: OpenableProject): Promise<void> {
  const refs = new Set(
    project.memberProjectRefs.map((ref) => `${ref.environmentId}:${ref.projectId}`),
  );
  const { tabs, recent } = useThreadTabsStore.getState();
  const tab = mostRecentThreadTab(
    recent,
    tabs.filter((candidate) => {
      const key = tabProjectRefKey(candidate);
      return key !== null && refs.has(key);
    }),
  );
  if (tab) return navigateToThreadTab(router, tab);
  return router.navigate({
    to: "/project/$environmentId/$projectId",
    params: { environmentId: project.environmentId, projectId: project.id },
  });
}
