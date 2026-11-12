import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { selectProjectGroupingSettings } from "@t3tools/client-runtime/state/project-grouping";
import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  AuthTerminalOperateScope,
  type EnvironmentId,
} from "@t3tools/contracts";
import { Navigate, useNavigate } from "@tanstack/react-router";
import { SearchIcon, TextSearchIcon } from "lucide-react";
import { useState, type KeyboardEvent } from "react";

import { openCommandPalette } from "../../commandPaletteBus";
import { useComposerDraftStore } from "../../composerDraftStore";
import { isElectron } from "../../env";
import { useProjectPin } from "../../hooks/useProjectGroupUpdate";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useClientSettings } from "../../hooks/useSettings";
import { useSidebarProjectGroups } from "../../hooks/useSidebarProjectGroups";
import { useStableCallback } from "../../hooks/useStableCallback";
import { workspaceAreaProps } from "../../lib/workspaceFocus";
import { readLocalApi } from "../../localApi";
import { cn } from "../../lib/utils";
import { requestProjectRun } from "../../projectRunStore";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import {
  getSidebarProjectSettingsKey,
  type SidebarProjectSnapshot,
} from "../../sidebarProjectGrouping";
import { clientHostEnvironmentAtom } from "../../state/clientHostEnvironment";
import {
  useAllEnvironmentShellsBootstrapped,
  useDelegatedUnderParent,
  useProjects,
  useQuietThreadShells,
} from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { readEnvironmentScope } from "../../state/session";
import { shellEnvironment } from "../../state/shell";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { useUiStateStore } from "../../uiStateStore";
import { sortSidebarV2ProjectGroups } from "../Sidebar.logic";
import { Button } from "../ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { SidebarInset } from "../ui/sidebar";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { HomeDockIcon, HomeNewProjectTile, HomeProjectTile } from "./HomeProjectTile";
import {
  homeDockProjects,
  latestHomeThread,
  NO_HOME_BADGES,
  orderHomeProjects,
  planHomeReorder,
  searchHomeProjects,
  summarizeHomeBadges,
} from "./homeScreen.logic";
import { useAppRunningThreadKeys } from "./useAppRunningThreadKeys";
import { useProjectIconActions } from "./useProjectIconActions";

type ProjectMenuAction =
  | "open-project"
  | "new-thread"
  | "open-latest"
  | "run-app"
  | "pin"
  | "unpin"
  | "open-folder"
  | "generate-icon"
  | "reset-icon"
  | "project-settings";

// Space picks a tile up so Enter keeps opening it.
const KEYBOARD_SENSOR_OPTIONS = {
  coordinateGetter: sortableKeyboardCoordinates,
  keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] },
};

/** Desktop pointers only: focusing a field on a touch device opens its keyboard. */
function focusSearchOnMount(input: HTMLInputElement | null) {
  if (
    input !== null &&
    document.activeElement === document.body &&
    window.matchMedia("(pointer: fine)").matches
  ) {
    input.focus({ preventScroll: true });
  }
}

function canOpenFolder(environmentId: EnvironmentId): boolean {
  return (
    appAtomRegistry.get(clientHostEnvironmentAtom(environmentId)) &&
    readEnvironmentScope(environmentId, AuthOrchestrationOperateScope) &&
    (appAtomRegistry
      .get(serverEnvironment.configValueAtom(environmentId))
      ?.availableEditors.includes("file-manager") ??
      false)
  );
}

function reportOpenFailure(error: unknown) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title: "Could not open the project",
      description: error instanceof Error ? error.message : "An unexpected error occurred.",
    }),
  );
}

export function HomeScreen() {
  const contentArea = workspaceAreaProps("home", 1, "Home");
  const navigate = useNavigate();
  const handleNewThread = useNewThreadHandler();
  const projects = useProjects();
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const projectGroups = useSidebarProjectGroups();
  const threads = useQuietThreadShells();
  const delegatedUnderParent = useDelegatedUnderParent();
  const projectOrder = useUiStateStore((state) => state.projectOrder);
  const reorderProjects = useUiStateStore((state) => state.reorderProjects);
  const localLastVisitedAtById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const draftSessions = useComposerDraftStore((state) => state.draftThreadsByThreadKey);
  const appRunningThreadKeys = useAppRunningThreadKeys();
  const threadSortOrder = useClientSettings((settings) => settings.sidebarThreadSortOrder);
  const groupingSettings = useClientSettings(selectProjectGroupingSettings);
  const { canPinProjectGroup, setProjectGroupPinned } = useProjectPin();
  const openInEditor = useAtomCommand(shellEnvironment.openInEditor, "open in editor");
  const projectIcon = useProjectIconActions();
  const [query, setQuery] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, KEYBOARD_SENSOR_OPTIONS),
  );

  const homeProjects = orderHomeProjects(
    sortSidebarV2ProjectGroups(projectGroups, threads, "updated_at", delegatedUnderParent),
    projectOrder,
  );
  const searching = query.trim().length > 0;
  const shownProjects = searchHomeProjects(homeProjects, query);
  const dockProjects = homeDockProjects(homeProjects);
  const badgesByProjectKey = summarizeHomeBadges({
    projects: homeProjects,
    threads,
    delegatedUnderParent,
    localLastVisitedAtById,
    appRunningThreadKeys,
    draftThreads: Object.values(draftSessions),
  });

  const openProject = async (project: SidebarProjectSnapshot, options?: { run: boolean }) => {
    const latest = latestHomeThread(project, threads, delegatedUnderParent, threadSortOrder);
    const projectRef = latest
      ? scopeProjectRef(latest.environmentId, latest.projectId)
      : scopeProjectRef(project.environmentId, project.id);
    if (options?.run) requestProjectRun(projectRef);
    if (latest) {
      await navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(latest.environmentId, latest.id)),
      });
      return;
    }
    await handleNewThread(projectRef);
  };

  const handleOpen = useStableCallback((project: SidebarProjectSnapshot) => {
    void navigate({
      to: "/project/$environmentId/$projectId",
      params: { environmentId: project.environmentId, projectId: project.id },
    }).catch(reportOpenFailure);
  });

  const handleContextMenu = useStableCallback(
    (project: SidebarProjectSnapshot, position: { readonly x: number; readonly y: number }) => {
      const api = readLocalApi();
      if (!api) return;
      const canPin = canPinProjectGroup(project);
      const hasThread =
        latestHomeThread(project, threads, delegatedUnderParent, threadSortOrder) !== null;
      void (async () => {
        const clicked = await settlePromise(() =>
          api.contextMenu.show<ProjectMenuAction>(
            [
              { id: "open-project", label: "Open project", icon: "folder-tree" },
              { id: "new-thread", label: "New thread", icon: "message-square-plus" },
              {
                id: "open-latest",
                label: "Open latest thread",
                icon: "message-square",
                disabled: !hasThread,
              },
              ...(readEnvironmentScope(project.environmentId, AuthTerminalOperateScope)
                ? [{ id: "run-app" as const, label: "Run app" }]
                : []),
              ...(canPin
                ? [
                    project.pinned
                      ? { id: "unpin" as const, label: "Unpin from dock", icon: "pin-off" }
                      : { id: "pin" as const, label: "Pin to dock", icon: "pin" },
                  ]
                : []),
              ...(canOpenFolder(project.environmentId)
                ? [{ id: "open-folder" as const, label: "Open folder", icon: "folder" }]
                : []),
              ...(readEnvironmentScope(project.environmentId, AuthOrchestrationOperateScope)
                ? [
                    { id: "generate-icon" as const, label: "Generate icon", separatorBefore: true },
                    ...(project.projectIcon
                      ? [{ id: "reset-icon" as const, label: "Reset icon" }]
                      : []),
                  ]
                : []),
              {
                id: "project-settings",
                label: "Project settings",
                icon: "settings",
                separatorBefore: true,
              },
            ],
            position,
          ),
        );
        if (clicked._tag === "Failure" || clicked.value === null) return;
        switch (clicked.value) {
          case "open-project":
            handleOpen(project);
            return;
          case "new-thread":
            void handleNewThread(scopeProjectRef(project.environmentId, project.id)).catch(
              reportOpenFailure,
            );
            return;
          case "open-latest":
            void openProject(project).catch(reportOpenFailure);
            return;
          case "run-app":
            void openProject(project, { run: true }).catch(reportOpenFailure);
            return;
          case "pin":
          case "unpin":
            setProjectGroupPinned(project, clicked.value === "pin");
            return;
          case "open-folder":
            void openInEditor({
              environmentId: project.environmentId,
              input: { cwd: project.workspaceRoot, editor: "file-manager" },
            });
            return;
          case "generate-icon":
            void projectIcon.generate(project);
            return;
          case "reset-icon":
            void projectIcon.reset(project);
            return;
          case "project-settings":
            void navigate({
              to: "/projects/$projectKey",
              params: {
                projectKey: getSidebarProjectSettingsKey(project, groupingSettings, projects),
              },
            });
            return;
        }
      })();
    },
  );

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return;
    const plan = planHomeReorder(homeProjects, projectOrder, String(active.id), String(over.id));
    if (plan) reorderProjects(plan.currentOrder, plan.dragged, plan.target);
  };

  const nameOf = (id: UniqueIdentifier) =>
    homeProjects.find((project) => project.projectKey === id)?.displayName ?? String(id);
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${nameOf(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over ? `${nameOf(active.id)} is at ${nameOf(over.id)}’s place.` : undefined,
    onDragEnd: ({ active, over }) =>
      over ? `${nameOf(active.id)} moved to ${nameOf(over.id)}’s place.` : undefined,
    onDragCancel: ({ active }) => `Stopped moving ${nameOf(active.id)}.`,
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && searching) {
      event.preventDefault();
      const top = shownProjects[0];
      if (top) handleOpen(top);
      else openCommandPalette({ query });
    } else if (event.key === "Escape" && query.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      setQuery("");
    }
  };

  if (!projects.some((project) => project.archivedAt == null)) {
    // A pending environment cannot prove the workspace is empty.
    return bootstrapped ? <Navigate to="/" replace /> : null;
  }

  const tileProps = (project: SidebarProjectSnapshot) => {
    const badges = badgesByProjectKey.get(project.projectKey) ?? NO_HOME_BADGES;
    return {
      project,
      attention: badges.attention,
      working: badges.working,
      appRunning: badges.appRunning,
      onOpen: handleOpen,
      onContextMenu: handleContextMenu,
    };
  };

  return (
    <SidebarInset
      {...contentArea}
      role="main"
      className="h-dvh min-h-0 overflow-hidden overscroll-y-none"
    >
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-background bg-linear-to-b from-info/22 via-info/6 via-50% to-primary/8">
        {/* The desktop window only moves where CSS opts in, so keep a titlebar strip. */}
        {isElectron ? <WorkspacePageHeader electron /> : null}
        <div className={cn("flex shrink-0 justify-center px-6 pb-12", !isElectron && "pt-10")}>
          <div className="w-full max-w-xl">
            <InputGroup variant="popover" size="lg">
              <InputGroupAddon>
                <SearchIcon aria-hidden />
              </InputGroupAddon>
              <InputGroupInput
                ref={focusSearchOnMount}
                size="lg"
                type="search"
                aria-label="Search projects and threads"
                placeholder="Search projects and threads"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                onKeyDown={handleSearchKeyDown}
              />
            </InputGroup>
          </div>
        </div>
        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto px-6 pt-4 scrollbar-gutter-both",
            dockProjects.length > 0 ? "pb-44" : "pb-12",
          )}
        >
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
            accessibility={{ announcements }}
          >
            <SortableContext
              items={shownProjects.map((project) => project.projectKey)}
              strategy={rectSortingStrategy}
            >
              <ul
                aria-label="Projects"
                className="mx-auto flex max-w-5xl flex-wrap justify-center gap-x-6 gap-y-8 sm:gap-x-10"
              >
                {shownProjects.map((project) => (
                  <HomeProjectTile
                    key={project.projectKey}
                    {...tileProps(project)}
                    dragDisabled={searching}
                  />
                ))}
                {searching ? null : <HomeNewProjectTile />}
              </ul>
            </SortableContext>
          </DndContext>
          {searching ? (
            <div className="mt-8 flex flex-col items-center gap-2">
              {shownProjects.length === 0 ? (
                <p className="text-sm text-muted-foreground">No projects match.</p>
              ) : null}
              <Button variant="ghost" size="sm" onClick={() => openCommandPalette({ query })}>
                <TextSearchIcon aria-hidden />
                Search threads for “{query.trim()}”
              </Button>
            </div>
          ) : null}
        </div>
        {dockProjects.length > 0 ? (
          <nav
            aria-label="Pinned projects"
            className="pointer-events-none absolute inset-x-0 bottom-8 flex justify-center px-4"
          >
            <ul className="dropdown-glass pointer-events-auto flex max-w-full min-w-64 items-start justify-center gap-5 overflow-x-auto rounded-4xl px-6 pt-4 pb-2 shadow-2xl shadow-black/20">
              {dockProjects.map((project) => (
                <HomeDockIcon key={project.projectKey} {...tileProps(project)} />
              ))}
            </ul>
          </nav>
        ) : null}
      </div>
    </SidebarInset>
  );
}
