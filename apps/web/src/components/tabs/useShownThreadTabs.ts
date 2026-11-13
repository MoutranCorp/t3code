import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";

import { useComposerDraftStore } from "../../composerDraftStore";
import { useSidebarProjectGroups } from "../../hooks/useSidebarProjectGroups";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { useQuietThreadShells } from "../../state/entities";
import { useThreadTabsStore } from "../../threadTabsStore";
import { deriveShownThreadTabs, type ShownThreadTab } from "./threadTabsView.logic";

export type ShownTab = ShownThreadTab<EnvironmentThreadShell, SidebarProjectSnapshot>;

/** Reads quiet shells, so a streaming thread does not re-render its tab every token. */
export function useShownThreadTabs(): {
  readonly shown: readonly ShownTab[];
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly projects: readonly SidebarProjectSnapshot[];
} {
  const tabs = useThreadTabsStore((state) => state.tabs);
  const threads = useQuietThreadShells();
  const drafts = useComposerDraftStore((state) => state.draftThreadsByThreadKey);
  const projects = useSidebarProjectGroups();
  const threadByKey = new Map(
    threads.map((thread) => [`${thread.environmentId}:${thread.id}`, thread] as const),
  );
  return {
    shown: deriveShownThreadTabs({ tabs, threadByKey, drafts, projects }),
    threads,
    projects,
  };
}
