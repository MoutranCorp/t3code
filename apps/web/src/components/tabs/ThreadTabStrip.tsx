import { closestCenter, DndContext, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import { restrictToFirstScrollableAncestor, restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import { horizontalListSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { useRouter } from "@tanstack/react-router";
import { ArrowLeftRightIcon, MessageSquareIcon, PlusIcon, XIcon } from "lucide-react";
import { memo, useEffect, useRef, type MouseEvent, type WheelEvent } from "react";

import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useStableCallback } from "../../hooks/useStableCallback";
import { cn } from "../../lib/utils";
import { readLocalApi } from "../../localApi";
import { type ThreadPane, useThreadTabsStore } from "../../threadTabsStore";
import { useUiStateStore } from "../../uiStateStore";
import { HomeProjectIcon } from "../home/HomeProjectTile";
import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  activateThreadTab,
  closeThreadTabsAndNavigate,
  openThreadTabInSplit,
  swapThreadPanes,
  useActiveThreadTabKey,
} from "./threadTabNavigation";
import { ThreadMarkDot } from "./ThreadMarkDot";
import {
  projectThreadTabs,
  resolveThreadMark,
  withLocalVisit,
  type ThreadMark,
} from "./threadTabsView.logic";
import { useShownThreadTabs, type ShownTab } from "./useShownThreadTabs";

const TAB_DRAG_MODIFIERS = [restrictToHorizontalAxis, restrictToFirstScrollableAncestor];

type TabMenuAction = "open-in-split" | "open-in-main" | "close-split" | "close" | "close-others";

/** "active" in this pane, "other" in the split's other pane. */
type TabPlacement = "active" | "other" | null;

function preventMiddleButtonDefault(event: MouseEvent) {
  // Middle press would otherwise start autoscroll, and middle click open a link.
  if (event.button === 1) event.preventDefault();
}

// Only a vertical mouse wheel is translated; horizontal input scrolls natively.
function scrollTabsWithWheel(event: WheelEvent<HTMLOListElement>) {
  if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
  event.currentTarget.scrollLeft += event.deltaY;
}

const ThreadTabItem = memo(function ThreadTabItem(props: {
  readonly tab: ShownTab;
  readonly placement: TabPlacement;
  readonly paneFocused: boolean;
  readonly mark: ThreadMark | null;
  readonly onActivate: (tab: ShownTab) => void;
  readonly onClose: (tab: ShownTab) => void;
  readonly onContextMenu: (tab: ShownTab, position: { x: number; y: number }) => void;
}) {
  const { tab, placement } = props;
  const active = placement === "active";
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tab.key });
  return (
    <li
      ref={setNodeRef}
      data-thread-tab-active={active}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "group/thread-tab flex h-7 max-w-52 min-w-24 shrink-0 items-center rounded-md text-xs",
        active
          ? props.paneFocused
            ? "bg-primary/15 font-medium text-foreground ring-1 ring-primary/60 ring-inset"
            : "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        placement === "other" && "ring-1 ring-border ring-inset",
        isDragging && "relative z-10",
      )}
      onMouseDown={preventMiddleButtonDefault}
      onMouseUp={preventMiddleButtonDefault}
      onAuxClick={(event) => {
        if (event.button !== 1) return;
        event.preventDefault();
        props.onClose(tab);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        props.onContextMenu(tab, { x: event.clientX, y: event.clientY });
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              ref={setActivatorNodeRef}
              type="button"
              {...attributes}
              {...listeners}
              aria-current={active ? "page" : undefined}
              className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md pr-1 pl-2 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              onClick={() => props.onActivate(tab)}
            />
          }
        >
          <span className="relative flex size-4 shrink-0 items-center justify-center">
            {tab.project ? (
              <span className="flex size-4 overflow-hidden rounded-sm">
                <HomeProjectIcon project={tab.project} size="mini" attention={0} working={false} />
              </span>
            ) : (
              <MessageSquareIcon aria-hidden className="size-3.5" />
            )}
            {props.mark ? (
              <ThreadMarkDot mark={props.mark} className="absolute -top-0.5 -right-0.5 size-2" />
            ) : null}
          </span>
          <span className="truncate">{tab.title}</span>
        </TooltipTrigger>
        <TooltipPopup side="bottom">
          <span className="block">{tab.title}</span>
          {tab.project ? (
            <span className="block text-muted-foreground">{tab.project.displayName}</span>
          ) : null}
          {placement === "other" ? (
            <span className="block text-muted-foreground">Open in the other pane</span>
          ) : null}
        </TooltipPopup>
      </Tooltip>
      <span
        className={cn(
          "flex shrink-0 pr-1",
          !active &&
            "opacity-0 group-hover/thread-tab:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100",
        )}
      >
        <button
          type="button"
          aria-label={`Close ${tab.title}`}
          className="flex size-4 cursor-pointer items-center justify-center rounded-sm hover:bg-muted"
          onClick={() => props.onClose(tab)}
        >
          <XIcon aria-hidden className="size-3" />
        </button>
      </span>
    </li>
  );
});

function StripIconButton(props: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label={props.label}
            onClick={props.onClick}
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup side="bottom">{props.label}</TooltipPopup>
    </Tooltip>
  );
}

/**
 * Browser-style tabs over a pane's thread, listing the tabs of that thread's project. The main
 * pane's active tab is the route's, the second pane's is its own.
 */
export function ThreadTabStrip(props: {
  readonly pane: ThreadPane;
  /** The thread the pane's chat shows; the second pane's active tab. */
  readonly paneThreadKey: string;
}) {
  const router = useRouter();
  const handleNewThread = useNewThreadHandler();
  const { shown: allShown } = useShownThreadTabs();
  const routeKey = useActiveThreadTabKey();
  const shownSplit = useThreadTabsStore((state) => state.shownSplit);
  const focusedPane = useThreadTabsStore((state) => state.focusedPane);
  const localLastVisitedAtById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const moveTab = useThreadTabsStore((state) => state.move);
  const scrollerRef = useRef<HTMLOListElement>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const secondary = props.pane === "secondary";
  const activeKey = secondary ? props.paneThreadKey : routeKey;
  const otherKey = secondary ? routeKey : shownSplit;
  const splitShown = shownSplit !== null;
  const paneFocused = !splitShown || (focusedPane === "secondary") === secondary;
  const shown = projectThreadTabs(allShown, activeKey);
  const activeTab = shown.find((tab) => tab.key === activeKey) ?? null;
  const routeProjectRef = allShown.find((tab) => tab.key === routeKey)?.projectRef;

  const activeTabKey = activeTab?.key ?? null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- scrolls the active tab's DOM node into view when navigation elsewhere changes it
  useEffect(() => {
    if (activeTabKey === null) return;
    scrollerRef.current
      ?.querySelector<HTMLElement>("[data-thread-tab-active='true']")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTabKey]);

  const shownKeys = shown.map((entry) => entry.key);
  const onActivate = useStableCallback((tab: ShownTab) => {
    activateThreadTab(router, props.pane, tab);
  });
  const onClose = useStableCallback((tab: ShownTab) =>
    closeThreadTabsAndNavigate(router, [tab.key], shownKeys, routeProjectRef),
  );
  const onContextMenu = useStableCallback(
    (tab: ShownTab, position: { readonly x: number; readonly y: number }) => {
      const api = readLocalApi();
      if (!api) return;
      const isThread = tab.tab.target.kind === "thread";
      void (async () => {
        const clicked = await settlePromise(() =>
          api.contextMenu.show<TabMenuAction>(
            [
              secondary
                ? { id: "open-in-main", label: "Open in main pane", disabled: tab.key === routeKey }
                : {
                    id: "open-in-split",
                    label: "Open in split view",
                    disabled: !isThread || tab.key === shownSplit,
                  },
              ...(splitShown ? [{ id: "close-split" as const, label: "Close split view" }] : []),
              { id: "close", label: "Close", separatorBefore: true },
              { id: "close-others", label: "Close others", disabled: shown.length <= 1 },
            ],
            position,
          ),
        );
        if (clicked._tag === "Failure" || clicked.value === null) return;
        switch (clicked.value) {
          case "open-in-split":
            openThreadTabInSplit(router, tab, allShown);
            return;
          case "open-in-main":
            activateThreadTab(router, "primary", tab);
            return;
          case "close-split":
            useThreadTabsStore.getState().closeSplit();
            return;
          case "close":
            closeThreadTabsAndNavigate(router, [tab.key], shownKeys, routeProjectRef);
            return;
          case "close-others":
            closeThreadTabsAndNavigate(
              router,
              shownKeys.filter((key) => key !== tab.key),
              shownKeys,
            );
            return;
        }
      })();
    },
  );
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) moveTab(String(active.id), String(over.id));
  };
  const newThread = () => {
    if (!activeTab) return;
    void handleNewThread(activeTab.projectRef).catch((error: unknown) =>
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not open a new thread",
          description: error instanceof Error ? error.message : "An unexpected error occurred.",
        }),
      ),
    );
  };

  if (shown.length === 0) return null;
  return (
    <div
      className={cn(
        "flex h-9 shrink-0 items-center gap-1 border-b border-border/60 bg-background pr-(--workspace-gutter-end) pl-(--workspace-gutter-start)",
        // With two panes, the focused one's tab bar is underlined.
        splitShown && paneFocused && "border-b-ring",
      )}
    >
      <nav
        aria-label={secondary ? "Open threads, split pane" : "Open threads"}
        className="flex min-w-0 flex-1"
      >
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={TAB_DRAG_MODIFIERS}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={shownKeys} strategy={horizontalListSortingStrategy}>
            <ol
              ref={scrollerRef}
              className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              onWheel={scrollTabsWithWheel}
            >
              {shown.map((tab) => (
                <ThreadTabItem
                  key={tab.key}
                  tab={tab}
                  placement={
                    tab.key === activeKey
                      ? "active"
                      : splitShown && tab.key === otherKey
                        ? "other"
                        : null
                  }
                  paneFocused={paneFocused}
                  mark={
                    tab.thread
                      ? resolveThreadMark(withLocalVisit(tab.thread, localLastVisitedAtById))
                      : null
                  }
                  onActivate={onActivate}
                  onClose={onClose}
                  onContextMenu={onContextMenu}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      </nav>
      {secondary ? (
        <>
          <StripIconButton label="Swap panes" onClick={() => swapThreadPanes(router, "secondary")}>
            <ArrowLeftRightIcon aria-hidden />
          </StripIconButton>
          <StripIconButton
            label="Close split view"
            onClick={() => useThreadTabsStore.getState().closeSplit()}
          >
            <XIcon aria-hidden />
          </StripIconButton>
        </>
      ) : activeTab ? (
        <StripIconButton
          label={`New thread in ${activeTab.project?.displayName ?? "this project"}`}
          onClick={newThread}
        >
          <PlusIcon aria-hidden />
        </StripIconButton>
      ) : null}
    </div>
  );
}
