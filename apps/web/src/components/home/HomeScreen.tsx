import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragMoveEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  type SortingStrategy,
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
import { cn, randomUUID } from "../../lib/utils";
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
import { type HomeFolder, useUiStateStore } from "../../uiStateStore";
import { sortSidebarV2ProjectGroups } from "../Sidebar.logic";
import { Button } from "../ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { SidebarInset } from "../ui/sidebar";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { DescribeProjectDialog } from "./DescribeProjectDialog";
import { HomeFolderDialog } from "./HomeFolderDialog";
import { ImportProjectsDialog } from "./ImportProjectsDialog";
import { HomeFolderTile } from "./HomeFolderTile";
import {
  addToHomeFolder,
  buildHomeEntries,
  createHomeFolder,
  homeEntryReorderItems,
  homeFolderEntryKey,
  homeFolderMemberKeys,
  isHomeGroupingDrop,
  nextHomeFolderName,
  pruneHomeFolders,
  removeFromHomeFolders,
  renameHomeFolder,
  resolveHomeFolders,
  sumHomeBadges,
  ungroupHomeFolder,
  type ResolvedHomeFolder,
} from "./homeFolders.logic";
import { HomeNewProjectTile } from "./HomeNewProjectTile";
import { HomeDockIcon, HomeProjectTile } from "./HomeProjectTile";
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
  | "project-settings"
  | "remove-from-folder"
  | "move-to-folder"
  | "new-folder-with"
  | `folder:${string}`
  | `with:${string}`;

type FolderMenuAction = "open" | "rename" | "ungroup";

/** Keyboard drags land exactly on a slot, so only pointer drags can make folders. */
const NO_SHIFT_STRATEGY: SortingStrategy = () => null;

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
  const homeFolders = useUiStateStore((state) => state.homeFolders);
  const updateHomeFolders = useUiStateStore((state) => state.updateHomeFolders);
  const localLastVisitedAtById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const draftSessions = useComposerDraftStore((state) => state.draftThreadsByThreadKey);
  const appRunningThreadKeys = useAppRunningThreadKeys();
  const threadSortOrder = useClientSettings((settings) => settings.sidebarThreadSortOrder);
  const groupingSettings = useClientSettings(selectProjectGroupingSettings);
  const { canPinProjectGroup, setProjectGroupPinned } = useProjectPin();
  const openInEditor = useAtomCommand(shellEnvironment.openInEditor, "open in editor");
  const projectIcon = useProjectIconActions();
  const [query, setQuery] = useState("");
  const [openFolder, setOpenFolder] = useState<{
    readonly id: string;
    readonly renaming: boolean;
  } | null>(null);
  const [groupingTargetKey, setGroupingTargetKey] = useState<string | null>(null);
  const [newProjectDialog, setNewProjectDialog] = useState<"describe" | "import" | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, KEYBOARD_SENSOR_OPTIONS),
  );

  const homeProjects = orderHomeProjects(
    sortSidebarV2ProjectGroups(projectGroups, threads, "updated_at", delegatedUnderParent),
    projectOrder,
  );
  const resolvedFolders = resolveHomeFolders(homeFolders, homeProjects);
  const entries = buildHomeEntries(homeProjects, resolvedFolders);
  const folderByProjectKey = new Map<string, ResolvedHomeFolder<SidebarProjectSnapshot>>(
    resolvedFolders.flatMap((resolved) =>
      resolved.projects.map((project) => [project.projectKey, resolved] as const),
    ),
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

  const changeFolders = (update: (folders: readonly HomeFolder[]) => readonly HomeFolder[]) =>
    updateHomeFolders((folders) => pruneHomeFolders(update(folders), homeProjects));

  /** Drops a project on a tile: onto a folder adds it, onto a project makes a folder of both. */
  const groupInto = (dragged: SidebarProjectSnapshot, targetKey: string) => {
    const target = entries.find((entry) => entry.key === targetKey);
    if (!target || target.key === dragged.projectKey) return;
    // Next to its target in the shared order, so the folder keeps the target’s place.
    const plan = planHomeReorder(
      homeEntryReorderItems(entries),
      projectOrder,
      dragged.projectKey,
      targetKey,
    );
    if (plan) reorderProjects(plan.currentOrder, plan.dragged, plan.target);
    const keys = homeFolderMemberKeys(dragged);
    if (target.kind === "folder") {
      changeFolders((folders) => addToHomeFolder(folders, target.folder.id, keys));
      return;
    }
    const id = randomUUID();
    changeFolders((folders) =>
      createHomeFolder(folders, {
        id,
        name: nextHomeFolderName(folders),
        memberKeys: [...homeFolderMemberKeys(target.project), ...keys],
      }),
    );
    setOpenFolder({ id, renaming: true });
  };

  const removeFromFolder = (project: SidebarProjectSnapshot) =>
    changeFolders((folders) => removeFromHomeFolders(folders, homeFolderMemberKeys(project)));

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
      const currentFolder = folderByProjectKey.get(project.projectKey) ?? null;
      const otherFolders = resolvedFolders.filter((resolved) => resolved !== currentFolder);
      const loneProjects = entries.flatMap((entry) =>
        entry.kind === "project" && entry.key !== project.projectKey ? [entry.project] : [],
      );
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
              ...(otherFolders.length > 0 || loneProjects.length > 0
                ? [
                    {
                      id: "move-to-folder" as const,
                      label: "Move to folder",
                      separatorBefore: true,
                      children: [
                        ...otherFolders.map(({ folder }) => ({
                          id: `folder:${folder.id}` as const,
                          label: folder.name,
                        })),
                        ...(loneProjects.length > 0
                          ? [
                              {
                                id: "new-folder-with" as const,
                                label: "New folder with",
                                header: true,
                                separatorBefore: otherFolders.length > 0,
                              },
                              ...loneProjects.map((other) => ({
                                id: `with:${other.projectKey}` as const,
                                label: other.displayName,
                              })),
                            ]
                          : []),
                      ],
                    },
                  ]
                : []),
              ...(currentFolder
                ? [
                    {
                      id: "remove-from-folder" as const,
                      label: `Remove from ${currentFolder.folder.name}`,
                      separatorBefore: otherFolders.length === 0 && loneProjects.length === 0,
                    },
                  ]
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
        const action = clicked.value;
        if (action.startsWith("folder:")) {
          groupInto(project, homeFolderEntryKey(action.slice("folder:".length)));
          return;
        }
        if (action.startsWith("with:")) {
          groupInto(project, action.slice("with:".length));
          return;
        }
        switch (action) {
          case "remove-from-folder":
            removeFromFolder(project);
            return;
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
            setProjectGroupPinned(project, action === "pin");
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

  const handleOpenFolder = useStableCallback((folderId: string) =>
    setOpenFolder({ id: folderId, renaming: false }),
  );

  const handleFolderContextMenu = useStableCallback(
    (folder: HomeFolder, position: { readonly x: number; readonly y: number }) => {
      const api = readLocalApi();
      if (!api) return;
      void (async () => {
        const clicked = await settlePromise(() =>
          api.contextMenu.show<FolderMenuAction>(
            [
              { id: "open", label: "Open folder", icon: "folder-open" },
              { id: "rename", label: "Rename" },
              { id: "ungroup", label: "Ungroup", separatorBefore: true },
            ],
            position,
          ),
        );
        if (clicked._tag === "Failure" || clicked.value === null) return;
        switch (clicked.value) {
          case "open":
          case "rename":
            setOpenFolder({ id: folder.id, renaming: clicked.value === "rename" });
            return;
          case "ungroup":
            changeFolders((folders) => ungroupHomeFolder(folders, folder.id));
            return;
        }
      })();
    },
  );

  const handleDragMove = ({ active, over, activatorEvent }: DragMoveEvent) => {
    const rect = active.rect.current.translated;
    const dragsProject = entries.some(
      (entry) => entry.kind === "project" && entry.key === active.id,
    );
    const next =
      dragsProject &&
      !(activatorEvent instanceof KeyboardEvent) &&
      over !== null &&
      over.id !== active.id &&
      rect !== null &&
      isHomeGroupingDrop(
        { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
        over.rect,
      )
        ? String(over.id)
        : null;
    if (next !== groupingTargetKey) setGroupingTargetKey(next);
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    const groupingKey = groupingTargetKey;
    setGroupingTargetKey(null);
    if (!over) return;
    const dragged = homeProjects.find((project) => project.projectKey === active.id);
    if (dragged && groupingKey !== null && groupingKey === over.id) {
      groupInto(dragged, groupingKey);
      return;
    }
    const plan = planHomeReorder(
      homeEntryReorderItems(entries),
      projectOrder,
      String(active.id),
      String(over.id),
    );
    if (plan) reorderProjects(plan.currentOrder, plan.dragged, plan.target);
  };

  const nameOf = (id: UniqueIdentifier) => {
    const entry = entries.find((candidate) => candidate.key === id);
    if (!entry) return String(id);
    return entry.kind === "project" ? entry.project.displayName : `the ${entry.folder.name} folder`;
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${nameOf(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over ? `${nameOf(active.id)} is at ${nameOf(over.id)}’s place.` : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? groupingTargetKey === over.id
          ? `${nameOf(active.id)} grouped with ${nameOf(over.id)}.`
          : `${nameOf(active.id)} moved to ${nameOf(over.id)}’s place.`
        : undefined,
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

  const shownFolder =
    openFolder === null
      ? null
      : (resolvedFolders.find((resolved) => resolved.folder.id === openFolder.id) ?? null);

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
            onDragMove={handleDragMove}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setGroupingTargetKey(null)}
            accessibility={{ announcements }}
          >
            <SortableContext
              items={
                searching
                  ? shownProjects.map((project) => project.projectKey)
                  : entries.map((entry) => entry.key)
              }
              // Tiles hold still while a dragged one hovers another's middle, so it can drop in.
              strategy={groupingTargetKey === null ? rectSortingStrategy : NO_SHIFT_STRATEGY}
            >
              <ul
                aria-label="Projects"
                className="mx-auto flex max-w-5xl flex-wrap justify-center gap-x-6 gap-y-8 sm:gap-x-10"
              >
                {searching
                  ? shownProjects.map((project) => (
                      <HomeProjectTile
                        key={project.projectKey}
                        {...tileProps(project)}
                        dragDisabled
                      />
                    ))
                  : entries.map((entry) =>
                      entry.kind === "project" ? (
                        <HomeProjectTile
                          key={entry.key}
                          {...tileProps(entry.project)}
                          dragDisabled={false}
                          groupingTarget={groupingTargetKey === entry.key}
                        />
                      ) : (
                        <HomeFolderTile
                          key={entry.key}
                          entryKey={entry.key}
                          folder={entry.folder}
                          projects={entry.projects}
                          {...sumHomeBadges(
                            entry.projects.map(
                              (project) =>
                                badgesByProjectKey.get(project.projectKey) ?? NO_HOME_BADGES,
                            ),
                          )}
                          dragDisabled={false}
                          groupingTarget={groupingTargetKey === entry.key}
                          onOpen={handleOpenFolder}
                          onContextMenu={handleFolderContextMenu}
                        />
                      ),
                    )}
                {searching ? null : (
                  <HomeNewProjectTile
                    onDescribe={() => setNewProjectDialog("describe")}
                    onImport={() => setNewProjectDialog("import")}
                  />
                )}
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
      {shownFolder ? (
        <HomeFolderDialog
          key={shownFolder.folder.id}
          folder={shownFolder.folder}
          projects={shownFolder.projects}
          renaming={openFolder?.renaming ?? false}
          tileProps={tileProps}
          onRename={(name) =>
            changeFolders((folders) => renameHomeFolder(folders, shownFolder.folder.id, name))
          }
          onReorder={(memberKeys) =>
            changeFolders((folders) =>
              folders.map((folder) =>
                folder.id === shownFolder.folder.id ? { ...folder, memberKeys } : folder,
              ),
            )
          }
          onRemove={removeFromFolder}
          onClose={() => setOpenFolder(null)}
        />
      ) : null}
      {newProjectDialog === "import" ? (
        <ImportProjectsDialog onClose={() => setNewProjectDialog(null)} />
      ) : null}
      {newProjectDialog === "describe" ? (
        <DescribeProjectDialog onClose={() => setNewProjectDialog(null)} />
      ) : null}
    </SidebarInset>
  );
}
