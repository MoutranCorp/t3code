import { closestCenter, DndContext, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import { restrictToFirstScrollableAncestor, restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import { horizontalListSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useRouter } from "@tanstack/react-router";
import { MessageSquareIcon, PlusIcon, XIcon } from "lucide-react";
import { memo, useEffect, useRef, type MouseEvent, type WheelEvent } from "react";

import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useStableCallback } from "../../hooks/useStableCallback";
import { cn } from "../../lib/utils";
import { useThreadTabsStore } from "../../threadTabsStore";
import { useUiStateStore } from "../../uiStateStore";
import { HomeProjectIcon } from "../home/HomeProjectTile";
import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  closeThreadTabsAndNavigate,
  navigateToThreadTab,
  useActiveThreadTabKey,
} from "./threadTabNavigation";
import { ThreadMarkDot } from "./ThreadMarkDot";
import { resolveThreadMark, withLocalVisit, type ThreadMark } from "./threadTabsView.logic";
import { useShownThreadTabs, type ShownTab } from "./useShownThreadTabs";

const TAB_DRAG_MODIFIERS = [restrictToHorizontalAxis, restrictToFirstScrollableAncestor];

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
  readonly active: boolean;
  readonly mark: ThreadMark | null;
  readonly onActivate: (tab: ShownTab) => void;
  readonly onClose: (tab: ShownTab) => void;
}) {
  const { tab, active } = props;
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
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        isDragging && "relative z-10",
      )}
      onMouseDown={preventMiddleButtonDefault}
      onMouseUp={preventMiddleButtonDefault}
      onAuxClick={(event) => {
        if (event.button !== 1) return;
        event.preventDefault();
        props.onClose(tab);
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

/** Browser-style tabs over the thread view; the route decides which one is active. */
export function ThreadTabStrip() {
  const router = useRouter();
  const handleNewThread = useNewThreadHandler();
  const { shown } = useShownThreadTabs();
  const activeKey = useActiveThreadTabKey();
  const localLastVisitedAtById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const moveTab = useThreadTabsStore((state) => state.move);
  const scrollerRef = useRef<HTMLOListElement>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const activeTab = shown.find((tab) => tab.key === activeKey) ?? null;

  const activeTabKey = activeTab?.key ?? null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- scrolls the active tab's DOM node into view when navigation elsewhere changes it
  useEffect(() => {
    if (activeTabKey === null) return;
    scrollerRef.current
      ?.querySelector<HTMLElement>("[data-thread-tab-active='true']")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTabKey]);

  const onActivate = useStableCallback((tab: ShownTab) => {
    if (tab.key !== activeKey) void navigateToThreadTab(router, tab.tab);
  });
  const onClose = useStableCallback((tab: ShownTab) =>
    closeThreadTabsAndNavigate(
      router,
      [tab.key],
      shown.map((entry) => entry.key),
    ),
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
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border/60 bg-background pr-(--workspace-gutter-end) pl-(--workspace-gutter-start)">
      <nav aria-label="Open threads" className="flex min-w-0 flex-1">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={TAB_DRAG_MODIFIERS}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={shown.map((tab) => tab.key)}
            strategy={horizontalListSortingStrategy}
          >
            <ol
              ref={scrollerRef}
              className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              onWheel={scrollTabsWithWheel}
            >
              {shown.map((tab) => (
                <ThreadTabItem
                  key={tab.key}
                  tab={tab}
                  active={tab.key === activeKey}
                  mark={
                    tab.thread
                      ? resolveThreadMark(withLocalVisit(tab.thread, localLastVisitedAtById))
                      : null
                  }
                  onActivate={onActivate}
                  onClose={onClose}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      </nav>
      {activeTab ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost-muted"
                aria-label={`New thread in ${activeTab.project?.displayName ?? "this project"}`}
                onClick={newThread}
              />
            }
          >
            <PlusIcon aria-hidden />
          </TooltipTrigger>
          <TooltipPopup side="bottom">
            New thread in {activeTab.project?.displayName ?? "this project"}
          </TooltipPopup>
        </Tooltip>
      ) : null}
    </div>
  );
}
