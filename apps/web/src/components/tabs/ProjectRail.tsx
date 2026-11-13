import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { PROJECT_RAIL_JUMP_KEYBINDING_COMMANDS, type KeybindingCommand } from "@t3tools/contracts";
import { useLocation, useParams, useRouter } from "@tanstack/react-router";
import { BellIcon, HouseIcon } from "lucide-react";
import { memo, useEffect, useState, type MouseEvent } from "react";

import { isCommandPaletteOpen } from "../../commandPaletteBus";
import { useComposerDraftStore } from "../../composerDraftStore";
import { isElectron } from "../../env";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useProjectPin } from "../../hooks/useProjectGroupUpdate";
import { useStableCallback } from "../../hooks/useStableCallback";
import { cn } from "../../lib/utils";
import { readLocalApi } from "../../localApi";
import { registerCommands, registerMenuAction } from "../../shortcuts/dispatcher";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { useDelegatedUnderParent } from "../../state/entities";
import { adjacentThreadTab } from "../../threadTabs.logic";
import { useThreadTabsStore } from "../../threadTabsStore";
import { buildThreadRouteParams } from "../../threadRoutes";
import { useUiStateStore } from "../../uiStateStore";
import { HomeProjectIcon } from "../home/HomeProjectTile";
import { homeDockProjects, orderHomeProjects } from "../home/homeScreen.logic";
import { isAppModalPage } from "../sidebar/mainAppLocation";
import { sortSidebarV2ProjectGroups } from "../Sidebar.logic";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { openProjectFromTabs } from "./openProjectFromTabs";
import {
  closeThreadTabsAndNavigate,
  focusOtherThreadPane,
  moveThreadTabToOtherPane,
  navigateToThreadTab,
  readActiveThreadTabKey,
  readFocusedPane,
  toggleSplitView,
  useActiveThreadTabKey,
} from "./threadTabNavigation";
import { ThreadMarkDot } from "./ThreadMarkDot";
import {
  buildRailProjects,
  describeThreadMarkCounts,
  deriveShownThreadTabs,
  strongestThreadMark,
  summarizeThreadMarks,
  THREAD_MARK_LABEL,
  type ThreadMarkCounts,
  type WaitingThread,
} from "./threadTabsView.logic";
import { useShownThreadTabs } from "./useShownThreadTabs";

type RailMenuAction = "open-project" | "new-thread" | "pin" | "unpin" | "close-tabs";

/** Commands the bar runs from the keyboard, the palette and forwarded preview shortcuts. */
const THREAD_TAB_COMMANDS = [
  "threadTab.next",
  "threadTab.previous",
  "threadTab.close",
  "threadTab.reopenClosed",
  "splitView.toggle",
  "splitView.moveTab",
  "splitView.focusOther",
] as const satisfies readonly KeybindingCommand[];

const NO_COUNTS: ThreadMarkCounts = { "needs-you": 0, error: 0, working: 0, done: 0 };

const RAIL_BUTTON_CLASS =
  "relative flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-sidebar-foreground/80 outline-none hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [-webkit-app-region:no-drag]";

function isKeybindingCaptureTarget(event: KeyboardEvent) {
  return event.target instanceof HTMLElement && event.target.closest("[data-keybinding-capture]");
}

function reportFailure(error: unknown) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title: "Could not open the project",
      description: error instanceof Error ? error.message : "An unexpected error occurred.",
    }),
  );
}

/** A keyboard-opened menu reports (0, 0), so it opens beside the element instead. */
function menuPosition(event: MouseEvent<HTMLElement>) {
  if (event.clientX !== 0 || event.clientY !== 0) return { x: event.clientX, y: event.clientY };
  const rect = event.currentTarget.getBoundingClientRect();
  return { x: rect.right, y: rect.top };
}

function ActiveIndicator() {
  return (
    <span
      aria-hidden
      className="absolute top-1/2 -left-1.5 h-5 w-1 -translate-y-1/2 rounded-r-full bg-sidebar-foreground"
    />
  );
}

const RailProjectButton = memo(function RailProjectButton(props: {
  readonly project: SidebarProjectSnapshot;
  readonly counts: ThreadMarkCounts;
  readonly active: boolean;
  readonly onOpen: (project: SidebarProjectSnapshot) => void;
  readonly onContextMenu: (
    project: SidebarProjectSnapshot,
    position: { readonly x: number; readonly y: number },
  ) => void;
}) {
  const { project, counts } = props;
  const mark = strongestThreadMark(counts);
  const summary = describeThreadMarkCounts(counts);
  return (
    <li className="flex">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-current={props.active ? "page" : undefined}
              aria-label={summary ? `${project.displayName}, ${summary}` : project.displayName}
              className={cn(RAIL_BUTTON_CLASS, props.active && "bg-sidebar-row-hover")}
              onClick={() => props.onOpen(project)}
              onContextMenu={(event) => {
                event.preventDefault();
                props.onContextMenu(project, menuPosition(event));
              }}
            />
          }
        >
          {props.active ? <ActiveIndicator /> : null}
          <span className="flex size-7 overflow-hidden rounded-md">
            <HomeProjectIcon project={project} size="mini" attention={0} working={false} />
          </span>
          {mark ? (
            <ThreadMarkDot mark={mark} className="absolute top-0.5 right-0.5 size-2.5" />
          ) : null}
        </TooltipTrigger>
        <TooltipPopup side="right">
          <span className="block font-medium">{project.displayName}</span>
          {summary ? <span className="block text-muted-foreground">{summary}</span> : null}
        </TooltipPopup>
      </Tooltip>
    </li>
  );
});

function NeedsYouButton(props: {
  readonly waiting: ReadonlyArray<WaitingThread<EnvironmentThreadShell>>;
  readonly projects: readonly SidebarProjectSnapshot[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const projectByKey = new Map(props.projects.map((project) => [project.projectKey, project]));
  const groups = props.projects.flatMap((project) => {
    const threads = props.waiting.filter((entry) => entry.projectKey === project.projectKey);
    return threads.length > 0 ? [{ project, threads }] : [];
  });
  const count = props.waiting.length;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <button
                  type="button"
                  aria-label={count > 0 ? `Needs you, ${count}` : "Needs you"}
                  className={RAIL_BUTTON_CLASS}
                />
              }
            />
          }
        >
          <BellIcon aria-hidden className="size-4" />
          {count > 0 ? (
            <span
              aria-hidden
              className="absolute top-0.5 right-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 text-3xs font-semibold text-black tabular-nums ring-2 ring-sidebar"
            >
              {count > 99 ? "99+" : count}
            </span>
          ) : null}
        </TooltipTrigger>
        <TooltipPopup side="right">Needs you</TooltipPopup>
      </Tooltip>
      <PopoverPopup side="right" align="end" width="md" padding="compact">
        {groups.length === 0 ? (
          <p className="px-1 py-2 text-sm text-muted-foreground">Nothing is waiting on you.</p>
        ) : (
          <div className="flex max-h-[min(28rem,70vh)] flex-col gap-3 overflow-y-auto">
            {groups.map(({ project, threads }) => (
              <section key={project.projectKey} className="flex flex-col gap-0.5">
                <h3 className="flex items-center gap-2 px-1 text-xs font-medium text-muted-foreground">
                  <span className="flex size-4 overflow-hidden rounded-sm">
                    <HomeProjectIcon
                      project={projectByKey.get(project.projectKey) ?? project}
                      size="mini"
                      attention={0}
                      working={false}
                    />
                  </span>
                  <span className="truncate">{project.displayName}</span>
                </h3>
                <ul className="flex flex-col">
                  {threads.map(({ thread, mark }) => (
                    <li key={`${thread.environmentId}:${thread.id}`}>
                      <button
                        type="button"
                        className="flex w-full cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent"
                        onClick={() => {
                          setOpen(false);
                          void router.navigate({
                            to: "/$environmentId/$threadId",
                            params: buildThreadRouteParams({
                              environmentId: thread.environmentId,
                              threadId: thread.id,
                            }),
                          });
                        }}
                      >
                        <ThreadMarkDot mark={mark} className="size-2 shrink-0 ring-0" />
                        <span className="min-w-0 flex-1 truncate">{thread.title}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {THREAD_MARK_LABEL[mark]}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </PopoverPopup>
    </Popover>
  );
}

/**
 * The always-visible project bar: Home, pinned projects, projects with open tabs or live work,
 * and what is waiting on the user. It also owns the tab and project keyboard commands.
 */
export function ProjectRail(props: { readonly reserveWindowControls: boolean }) {
  const router = useRouter();
  const handleNewThread = useNewThreadHandler();
  const { shown, threads, projects } = useShownThreadTabs();
  const delegatedUnderParent = useDelegatedUnderParent();
  const projectOrder = useUiStateStore((state) => state.projectOrder);
  const localLastVisitedAtById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const { canPinProjectGroup, setProjectGroupPinned } = useProjectPin();
  const activeTabKey = useActiveThreadTabKey();
  const pathname = useLocation({ select: (location) => location.pathname });
  const routeEnvironmentId = useParams({ strict: false, select: (params) => params.environmentId });
  const routeProjectId = useParams({ strict: false, select: (params) => params.projectId });

  const { countsByProjectKey, waiting } = summarizeThreadMarks({
    projects,
    threads,
    delegatedUnderParent,
    localLastVisitedAtById,
  });
  const busyProjectKeys = new Set(
    [...countsByProjectKey].flatMap(([key, counts]) =>
      counts["needs-you"] + counts.error + counts.working > 0 ? [key] : [],
    ),
  );
  const rail = buildRailProjects({
    pinned: homeDockProjects(
      orderHomeProjects(
        sortSidebarV2ProjectGroups(projects, threads, "updated_at", delegatedUnderParent),
        projectOrder,
      ),
    ),
    projects,
    tabProjectKeys: shown.flatMap((tab) => (tab.project ? [tab.project.projectKey] : [])),
    busyProjectKeys,
  });
  const railProjects = [...rail.pinned, ...rail.open];
  const activeProjectKey =
    shown.find((tab) => tab.key === activeTabKey)?.project?.projectKey ??
    (pathname.startsWith("/project/") && routeEnvironmentId && routeProjectId
      ? projects.find((project) =>
          project.memberProjectRefs.some(
            (ref) => ref.environmentId === routeEnvironmentId && ref.projectId === routeProjectId,
          ),
        )?.projectKey
      : undefined) ??
    null;

  const openProject = useStableCallback((project: SidebarProjectSnapshot) => {
    void openProjectFromTabs(router, project).catch(reportFailure);
  });

  const handleContextMenu = useStableCallback(
    (project: SidebarProjectSnapshot, position: { readonly x: number; readonly y: number }) => {
      const api = readLocalApi();
      if (!api) return;
      const projectTabKeys = shown.flatMap((tab) =>
        tab.project?.projectKey === project.projectKey ? [tab.key] : [],
      );
      void (async () => {
        const clicked = await settlePromise(() =>
          api.contextMenu.show<RailMenuAction>(
            [
              { id: "open-project", label: "Open project screen", icon: "folder-tree" },
              { id: "new-thread", label: "New thread", icon: "message-square-plus" },
              ...(canPinProjectGroup(project)
                ? [
                    project.pinned
                      ? { id: "unpin" as const, label: "Unpin", icon: "pin-off" }
                      : { id: "pin" as const, label: "Pin", icon: "pin" },
                  ]
                : []),
              {
                id: "close-tabs",
                label: "Close project's tabs",
                disabled: projectTabKeys.length === 0,
                separatorBefore: true,
              },
            ],
            position,
          ),
        );
        if (clicked._tag === "Failure" || clicked.value === null) return;
        switch (clicked.value) {
          case "open-project":
            void router
              .navigate({
                to: "/project/$environmentId/$projectId",
                params: { environmentId: project.environmentId, projectId: project.id },
              })
              .catch(reportFailure);
            return;
          case "new-thread":
            void handleNewThread(scopeProjectRef(project.environmentId, project.id)).catch(
              reportFailure,
            );
            return;
          case "pin":
          case "unpin":
            setProjectGroupPinned(project, clicked.value === "pin");
            return;
          case "close-tabs":
            closeThreadTabsAndNavigate(
              router,
              projectTabKeys,
              shown.map((tab) => tab.key),
            );
            return;
        }
      })();
    },
  );

  // Event-time handlers: they read the last committed render, so registering once is enough.
  // Tab commands act on the focused split pane, which cycles past the other pane's tab.
  const runTabCommand = useStableCallback(
    (command: (typeof THREAD_TAB_COMMANDS)[number]): boolean => {
      const routeKey = readActiveThreadTabKey(router);
      const { shownSplit } = useThreadTabsStore.getState();
      const pane = readFocusedPane();
      const activeKey = pane === "secondary" ? shownSplit : routeKey;
      const shownKeys = shown.map((tab) => tab.key);
      switch (command) {
        case "threadTab.next":
        case "threadTab.previous": {
          const paneTabs =
            pane === "secondary"
              ? shown.filter((tab) => tab.key !== routeKey && tab.tab.target.kind === "thread")
              : shown.filter((tab) => tab.key !== shownSplit);
          const next = adjacentThreadTab(
            paneTabs,
            activeKey,
            command === "threadTab.next" ? 1 : -1,
          );
          if (next && next.key !== activeKey) {
            if (pane === "secondary") useThreadTabsStore.getState().showInSplit(next.key);
            else void navigateToThreadTab(router, next.tab);
          }
          return next !== null;
        }
        case "threadTab.close":
          if (activeKey === null || !shownKeys.includes(activeKey)) return false;
          closeThreadTabsAndNavigate(router, [activeKey], shownKeys);
          return true;
        case "splitView.toggle":
          return toggleSplitView(router, shown);
        case "splitView.moveTab":
          return moveThreadTabToOtherPane(router, shown);
        case "splitView.focusOther":
          return focusOtherThreadPane();
        case "threadTab.reopenClosed": {
          const threadByKey = new Map(
            threads.map((thread) => [`${thread.environmentId}:${thread.id}`, thread] as const),
          );
          const { draftThreadsByThreadKey } = useComposerDraftStore.getState();
          const tab = useThreadTabsStore.getState().takeClosed(
            (candidate) =>
              deriveShownThreadTabs({
                tabs: [candidate],
                threadByKey,
                drafts: draftThreadsByThreadKey,
                projects,
              }).length > 0,
          );
          if (tab) void navigateToThreadTab(router, tab);
          return tab !== null;
        }
      }
    },
  );
  const jumpToProject = useStableCallback((index: number): boolean => {
    const project = railProjects[index];
    if (!project) return false;
    openProject(project);
    return true;
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers the bar's tab and project commands with the app keyboard dispatcher and desktop menu actions
  useEffect(() => {
    const modalOpen = () =>
      router.state.matches.some((match) => isAppModalPage(match.pathname)) ||
      isCommandPaletteOpen();
    const claim = (handled: boolean, event: KeyboardEvent) => {
      if (!handled) return false;
      event.preventDefault();
      event.stopPropagation();
      return true;
    };
    const disposers = [
      // Capture, so the keys also leave widgets that swallow them, such as the terminal.
      registerCommands(
        {
          ...Object.fromEntries(
            THREAD_TAB_COMMANDS.map((command) => [
              command,
              (event: KeyboardEvent) => claim(runTabCommand(command), event),
            ]),
          ),
          ...Object.fromEntries(
            PROJECT_RAIL_JUMP_KEYBINDING_COMMANDS.map((command, index) => [
              command,
              (event: KeyboardEvent) => claim(jumpToProject(index), event),
            ]),
          ),
        },
        {
          capture: true,
          when: (event) => !isKeybindingCaptureTarget(event) && !modalOpen(),
          context: () => ({ usagePageOpen: router.state.location.pathname === "/usage" }),
        },
      ),
      // Cmd/Ctrl+W closes the right panel's tab first; with none to close, it closes the thread's.
      registerCommands(
        {
          "rightPanel.close": (event) =>
            claim(!event.repeat && runTabCommand("threadTab.close"), event),
        },
        { when: (event) => !isKeybindingCaptureTarget(event) && !modalOpen() },
      ),
      ...THREAD_TAB_COMMANDS.map((command) =>
        registerMenuAction(command, () => {
          runTabCommand(command);
        }),
      ),
    ];
    return () => {
      for (const dispose of disposers) dispose();
    };
  }, [router, runTabCommand, jumpToProject]);

  const homeActive = pathname === "/home";
  const homeButton = (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label="Home"
            aria-current={homeActive ? "page" : undefined}
            className={cn(RAIL_BUTTON_CLASS, homeActive && "bg-sidebar-row-hover")}
            onClick={() => void router.navigate({ to: "/home" })}
          />
        }
      >
        {homeActive ? <ActiveIndicator /> : null}
        <HouseIcon aria-hidden className="size-4" />
      </TooltipTrigger>
      <TooltipPopup side="right">Home</TooltipPopup>
    </Tooltip>
  );
  const renderProject = (project: SidebarProjectSnapshot) => (
    <RailProjectButton
      key={project.projectKey}
      project={project}
      counts={countsByProjectKey.get(project.projectKey) ?? NO_COUNTS}
      active={project.projectKey === activeProjectKey}
      onOpen={openProject}
      onContextMenu={handleContextMenu}
    />
  );

  return (
    <nav
      aria-label="Projects"
      className="relative z-20 hidden h-dvh w-(--sidebar-offset-left) shrink-0 flex-col items-center border-r border-sidebar-border bg-sidebar pb-2 surface-grain md:flex"
    >
      {/* The titlebar row: it moves the window, and on macOS sits under the traffic lights. */}
      <div
        className={cn(
          "flex h-(--workspace-topbar-height) w-full shrink-0 items-center justify-center",
          isElectron && "drag-region",
        )}
      >
        {props.reserveWindowControls ? null : homeButton}
      </div>
      {props.reserveWindowControls ? homeButton : null}
      <ul
        aria-label="Pinned and open projects"
        className="mt-2 flex min-h-0 w-full flex-1 flex-col items-center gap-1.5 overflow-y-auto pt-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {rail.pinned.map(renderProject)}
        {rail.pinned.length > 0 && rail.open.length > 0 ? (
          <li aria-hidden className="my-0.5 h-px w-6 shrink-0 bg-sidebar-border" />
        ) : null}
        {rail.open.map(renderProject)}
      </ul>
      <NeedsYouButton waiting={waiting} projects={projects} />
    </nav>
  );
}
