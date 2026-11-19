import { uuidv4 } from "../../lib/uuid";
import { ThreadUndoNotice } from "./ThreadUndoNotice";
import { use } from "react";
import { NativePrimaryColumnContext } from "../../native/v5-workspace-context";
import { useNavigation } from "@react-navigation/native";
import { useAtomValue } from "@effect/atom-react";
import { homeDockProjects } from "@t3tools/client-runtime/home-projects";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { useMemo, useState } from "react";
import { Platform } from "react-native";
import { useGT, useMessages } from "gt-react-native";

import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { pickableProjectGroups } from "@t3tools/client-runtime/state/project-grouping";

import { useProjects } from "../../state/entities";
import { steadyNavigationThreadShellsAtom } from "../../state/threads";
import { useLaunchingThreads, usePendingNewTasks } from "../../state/use-pending-new-tasks";
import { useWorkspaceState } from "../../state/workspace";
import { useSavedRemoteConnections } from "../../state/use-remote-environment-registry";
import {
  useAdaptiveWorkspaceLayout,
  useWorkspacePaneState,
} from "../layout/AdaptiveWorkspaceLayout";
import { AndroidHomeFabLayout } from "./AndroidHomeFab";
import { HomeScreen } from "./HomeScreen";
import { useHomeListOptions } from "./home-list-options";
import {
  runWhenHomeCovered,
  useAtomValueWhileVisible,
  useHomeRouteVisible,
} from "./home-route-visibility";
import {
  buildHomeProjectScopes,
  resolveHomeProjectFilterScope,
  sortHomeProjectScopes,
} from "./homeThreadList";
import { HomeProjectGrid } from "./HomeProjectGrid";
import { buildHomeGridProjects, type HomeGridProject } from "./homeProjectGrid.logic";
import { usePaneRole } from "../../components/ui/Pane";
import { runningProjectKeysAtom } from "../../state/project-runs";
import { usePendingTaskListActions } from "./usePendingTaskListActions";
import { useThreadListActions } from "./useThreadListActions";
import { useWorkspaceTabs } from "../layout/workspace/WorkspaceTabsContext";
import { openSettings } from "../settings/settings-navigation";
import { useSelectWorkspaceTab } from "../layout/workspace/useSelectWorkspaceTab";
import { useSelectWorkspaceDetail } from "../layout/workspace/useSelectWorkspaceDetail";
import { WorkspaceListEmptyDetail } from "../layout/workspace/WorkspaceListEmptyDetail";
import { WorkspaceListHeader } from "../layout/workspace/WorkspaceListHeader";
import { buildHomeListFilterMenuItems, homeListFilterEnvironments } from "./home-list-filter-menu";

export function HomeRouteScreen() {
  const gt = useGT();
  const m = useMessages();
  const nativePrimaryColumn = use(NativePrimaryColumnContext);
  // Split view keeps the list: it is the sidebar beside the open thread.
  const sidebarSurface = usePaneRole() === "sidebar" && nativePrimaryColumn !== null;
  const [view, setView] = useState<"projects" | "threads">("projects");
  const runningProjectKeys = useAtomValue(runningProjectKeysAtom);
  const { layout, setPrimarySidebarSearchQuery, startNewTask } = useAdaptiveWorkspaceLayout();
  const { primarySidebarSearchQuery } = useWorkspacePaneState();
  const selectDetail = useSelectWorkspaceDetail();
  const projects = useProjects();
  // Stop rebuilding the streaming thread list while Thread covers Home.
  const visible = useHomeRouteVisible();
  const threads = useLaunchingThreads(
    useAtomValueWhileVisible(steadyNavigationThreadShellsAtom, visible),
  );
  const { environments: workspaceEnvironments, state: catalogState } = useWorkspaceState();
  const { savedConnectionsById } = useSavedRemoteConnections();
  const navigation = useNavigation();
  const selectTab = useSelectWorkspaceTab();
  const workspace = useWorkspaceTabs();
  const [localSearchQuery, setLocalSearchQuery] = useState("");
  const searchQuery =
    Platform.OS === "android"
      ? primarySidebarSearchQuery
      : (workspace?.state.tabs.threads.query ?? localSearchQuery);
  const setSearchQuery = (query: string) => {
    if (Platform.OS === "android") setPrimarySidebarSearchQuery(query);
    else if (workspace) workspace.dispatch({ type: "query", query, tab: "threads" });
    else setLocalSearchQuery(query);
  };
  // Split layouts keep the query; only the stacked layout opens the thread over the list.
  // Android's search field keeps its own open state, which a cleared query would leave open.
  const clearsSearchOnOpen = Platform.OS !== "android" && !layout.usesSplitView;
  const selectThreadRoute = (params: ReactNavigation.RootParamList["Thread"]) => {
    if (searchQuery !== "" && clearsSearchOnOpen && workspace)
      runWhenHomeCovered(() => workspace.cancelSearch("threads"));
    selectDetail({ name: "Thread", params });
  };
  const handleSelectThread = (thread: EnvironmentThreadShell) =>
    selectThreadRoute({ environmentId: String(thread.environmentId), threadId: String(thread.id) });
  const handleNewThreadInProject = (project: EnvironmentProject) =>
    selectThreadRoute({
      draft: {
        requestId: uuidv4(),
        environmentId: String(project.environmentId),
        projectId: String(project.id),
        title: project.title,
      },
    });
  const handleNewThreadOnBranch = (thread: EnvironmentThreadShell) => {
    selectThreadRoute({
      draft: {
        requestId: uuidv4(),
        environmentId: String(thread.environmentId),
        projectId: String(thread.projectId),
        branch: thread.branch,
        worktreePath: thread.worktreePath,
      },
    });
  };

  const {
    archiveThread,
    confirmDeleteThread,
    settleThread,
    snoozeThread,
    unsnoozeThread,
    pinThread,
    unpinThread,
    setThreadAutoSettle,
    moveThread,
    renameThread,
    regenerateThreadTitle,
    unsettleThread,
  } = useThreadListActions();
  const pendingTasks = usePendingNewTasks();
  const { openPendingTask, confirmDeletePendingTask } =
    usePendingTaskListActions(selectThreadRoute);
  const environments = homeListFilterEnvironments(workspaceEnvironments);
  const availableEnvironmentIds = useMemo(
    () => new Set(environments.map((environment) => environment.environmentId)),
    [environments],
  );
  const {
    options: listOptions,
    setSelectedEnvironmentId,
    setSelectedProjectKey,
  } = useHomeListOptions(availableEnvironmentIds);
  const selectedEnvironmentId = listOptions.selectedEnvironmentId;
  const projectScopes = useMemo(
    () =>
      buildHomeProjectScopes(
        {
          projects,
          environmentId: selectedEnvironmentId,
          projectGroupingMode: listOptions.projectGroupingMode,
        },
        m,
      ),
    [listOptions.projectGroupingMode, projects, selectedEnvironmentId, m],
  );
  const projectFilterOptions = useMemo(
    () =>
      pickableProjectGroups(
        sortHomeProjectScopes({
          scopes: projectScopes,
          threads,
          pendingTasks: [],
          projectSortOrder: "updated_at",
        }),
      ).map((scope) => ({
        key: scope.key,
        label: scope.title,
      })),
    [projectScopes, threads],
  );
  const selectedProjectKey =
    resolveHomeProjectFilterScope(projectScopes, projects, listOptions)?.key ?? null;

  // Without projects the list's empty states explain what to do next.
  const gridAvailable =
    !sidebarSurface && projects.some((project) => project.archivedAt == null && !project.isScratch);
  // An empty thread list would strand iOS, whose way back to the grid sits in the list header.
  const hasThreads =
    pendingTasks.length > 0 || threads.some((thread) => thread.archivedAt === null);
  const showProjects = gridAvailable && (view === "projects" || !hasThreads);
  const handleProjectFilterChange = (projectKey: string | null) => {
    setSelectedProjectKey(projectKey);
    if (projectKey !== null) setView("threads");
  };
  const handleOpenProject = (project: HomeGridProject) => {
    if (!project.hasThreads) {
      handleNewThreadInProject(project.representative);
      return;
    }
    setSelectedProjectKey(project.key);
    setView("threads");
  };
  const handleShowThreads = () => {
    setSelectedProjectKey(null);
    setView("threads");
  };
  const gridProjects = showProjects
    ? buildHomeGridProjects({
        scopes: sortHomeProjectScopes({
          scopes: buildHomeProjectScopes({
            projects,
            environmentId: selectedEnvironmentId,
            projectGroupingMode: listOptions.projectGroupingMode,
          }),
          threads,
          pendingTasks,
          projectSortOrder: listOptions.projectSortOrder,
        }),
        threads,
        runningProjectKeys,
        environmentLabel: (environmentId) =>
          savedConnectionsById[environmentId]?.environmentLabel ?? null,
        query: searchQuery,
      })
    : [];
  const orderedGridProjects =
    searchQuery.trim().length > 0
      ? gridProjects
      : [...homeDockProjects(gridProjects), ...gridProjects.filter((project) => !project.pinned)];

  if (layout.usesSplitView && !nativePrimaryColumn) {
    return (
      <WorkspaceListEmptyDetail
        hasConnections={catalogState.hasConnections}
        onAddConnection={() => openSettings(navigation, "SettingsEnvironmentNew")}
        onStartNewTask={startNewTask}
      />
    );
  }

  return (
    <AndroidHomeFabLayout onStartNewTask={startNewTask}>
      <>
        <WorkspaceListHeader
          accessibilityLabel={gt("Facio, Threads")}
          onOpenEnvironments={() => openSettings(navigation, "SettingsEnvironments")}
          search={{
            value: searchQuery,
            onChangeText: setSearchQuery,
            placeholder: gt("Search", { $context: "search field placeholder" }),
            accessibilityLabel: gt("Search threads"),
          }}
          filter={{
            customized: selectedEnvironmentId !== null || selectedProjectKey !== null,
            items: buildHomeListFilterMenuItems(
              {
                environments,
                projects: projectFilterOptions,
                selectedEnvironmentId,
                selectedProjectKey,
                onEnvironmentChange: setSelectedEnvironmentId,
                onProjectChange: gridAvailable ? handleProjectFilterChange : setSelectedProjectKey,
                ...(!gridAvailable
                  ? {}
                  : {
                      view: {
                        showingProjects: showProjects,
                        onShowProjects: () => setView("projects"),
                        onShowThreads: handleShowThreads,
                      },
                    }),
              },
              m,
            ),
          }}
        />

        {showProjects ? (
          <HomeProjectGrid
            projects={orderedGridProjects}
            searchQuery={searchQuery}
            onOpenProject={handleOpenProject}
            onShowThreads={hasThreads ? handleShowThreads : undefined}
          />
        ) : (
          <HomeScreen
            catalogState={catalogState}
            environments={environments}
            onAddConnection={() => openSettings(navigation, "SettingsEnvironmentNew")}
            onArchiveThread={archiveThread}
            onDeleteThread={confirmDeleteThread}
            onSettleThread={settleThread}
            onSnoozeThread={snoozeThread}
            onUnsnoozeThread={unsnoozeThread}
            onUnsettleThread={unsettleThread}
            onPinThread={pinThread}
            onUnpinThread={unpinThread}
            onSetThreadAutoSettle={setThreadAutoSettle}
            onMoveThread={moveThread}
            onRenameThread={renameThread}
            onRegenerateThreadTitle={regenerateThreadTitle}
            onEnvironmentChange={setSelectedEnvironmentId}
            onProjectChange={setSelectedProjectKey}
            onOpenSettings={() => selectTab("settings")}
            onSearchQueryChange={setSearchQuery}
            onSelectThread={handleSelectThread}
            onSelectPendingTask={openPendingTask}
            onDeletePendingTask={confirmDeletePendingTask}
            onNewThreadOnBranch={handleNewThreadOnBranch}
            onNewThreadInProject={handleNewThreadInProject}
            onShowProjects={gridAvailable ? () => setView("projects") : undefined}
            onStartNewTask={startNewTask}
            pendingTasks={pendingTasks}
            projectGroupingMode={listOptions.projectGroupingMode}
            projects={projects}
            projectSortOrder={listOptions.projectSortOrder}
            savedConnectionsById={savedConnectionsById}
            searchQuery={searchQuery}
            selectedEnvironmentId={selectedEnvironmentId}
            selectedProjectKey={selectedProjectKey}
            threads={threads}
            visible={visible}
          />
        )}
        <ThreadUndoNotice visible={visible} />
      </>
    </AndroidHomeFabLayout>
  );
}
