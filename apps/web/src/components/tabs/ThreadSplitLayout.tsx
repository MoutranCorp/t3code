import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

import { ComposerHandleContext } from "../../composerHandleContext";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useRightPanelStore } from "../../rightPanelStore";
import { useQuietThreadShell } from "../../state/entities";
import { useTerminalUiStateStore } from "../../terminalUiStateStore";
import { clampSplitRatio, DEFAULT_SPLIT_RATIO, resolveSplitTabKey } from "../../threadTabs.logic";
import { type ThreadPane, useThreadTabsStore } from "../../threadTabsStore";
import type { ChatComposerHandle } from "../chat/ChatComposer";
import { BackgroundThreadContext, InactiveThreadPaneContext } from "../chat/backgroundThread";
import ChatView from "../ChatView";
import { SPLIT_VIEW_MEDIA_QUERY, swapThreadPanes } from "./threadTabNavigation";
import { opensRightPanel, opensTerminalDrawer } from "./threadSplit.logic";

const MIN_PANE_WIDTH = 360;
const KEYBOARD_RESIZE_STEP = 0.05;

function focusPane(pane: ThreadPane) {
  useThreadTabsStore.getState().focusPane(pane);
}

/**
 * The thread area: the route's thread, and beside it the split view's second pane when one is
 * open and the window is wide enough. The main pane stays in the same place either way, so
 * opening or closing the split never remounts its thread.
 */
export function ThreadSplitLayout(props: {
  readonly primaryKey: string | null;
  readonly background: boolean;
  readonly children: ReactNode;
}) {
  const { primaryKey, background } = props;
  const available = useMediaQuery(SPLIT_VIEW_MEDIA_QUERY);
  const split = useThreadTabsStore((state) => state.split);
  const ratio = useThreadTabsStore((state) => state.splitRatio);
  const focusedPane = useThreadTabsStore((state) => state.focusedPane);
  // The route can reach the split's thread before its tab tracking swaps the panes; until then
  // the second pane shows the thread the route left, so no thread renders twice.
  const [route, setRoute] = useState({ current: primaryKey, previous: null as string | null });
  if (route.current !== primaryKey) setRoute({ current: primaryKey, previous: route.current });
  const previousKey = route.current === primaryKey ? route.previous : route.current;
  const splitKey = available ? resolveSplitTabKey(split, primaryKey, previousKey) : null;
  const splitRef = splitKey === null ? null : parseScopedThreadKey(splitKey);
  const splitShell = useQuietThreadShell(splitRef);
  const splitShown =
    splitKey !== null &&
    splitRef !== null &&
    splitShell !== null &&
    splitShell.archivedAt === null &&
    splitShell.deletedAt == null;
  const containerRef = useRef<HTMLDivElement>(null);
  const primaryInactive = splitShown && focusedPane === "secondary";

  return (
    <div
      ref={containerRef}
      className="flex min-h-0 min-w-0 flex-1"
      style={{ "--thread-split-ratio": ratio } as CSSProperties}
    >
      <div
        data-thread-pane="primary"
        className={
          splitShown
            ? // Contained, the main pane's fixed title bar controls sit at its own top right.
              "flex min-h-0 min-w-0 shrink-0 flex-col [contain:layout] [--workspace-controls-right:0.75rem] [--workspace-native-controls-inset:0px] w-[calc(var(--thread-split-ratio)*100%)]"
            : "flex min-h-0 min-w-0 flex-1 flex-col"
        }
        onPointerDownCapture={() => focusPane("primary")}
        onFocusCapture={() => focusPane("primary")}
      >
        <BackgroundThreadContext value={background || primaryInactive}>
          <InactiveThreadPaneContext value={primaryInactive}>
            {props.children}
          </InactiveThreadPaneContext>
        </BackgroundThreadContext>
      </div>
      {splitShown ? (
        <>
          <SplitDivider containerRef={containerRef} ratio={ratio} />
          <SecondaryThreadPane
            threadKey={splitKey}
            threadRef={splitRef}
            background={background}
            inactive={focusedPane !== "secondary"}
          />
        </>
      ) : null}
    </div>
  );
}

function SplitDivider(props: {
  readonly containerRef: { readonly current: HTMLDivElement | null };
  readonly ratio: number;
}) {
  const setSplitRatio = useThreadTabsStore((state) => state.setSplitRatio);
  const clampToContainer = (next: number) =>
    clampSplitRatio(
      next,
      props.containerRef.current?.getBoundingClientRect().width ?? 0,
      MIN_PANE_WIDTH,
    );

  // Drags write the ratio straight to the container, so neither thread re-renders per move.
  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    const container = props.containerRef.current;
    if (event.button !== 0 || !container) return;
    event.preventDefault();
    const divider = event.currentTarget;
    divider.setPointerCapture(event.pointerId);
    const bounds = container.getBoundingClientRect();
    let next = props.ratio;
    const move = (moveEvent: globalThis.PointerEvent) => {
      next = clampSplitRatio(
        (moveEvent.clientX - bounds.left) / bounds.width,
        bounds.width,
        MIN_PANE_WIDTH,
      );
      container.style.setProperty("--thread-split-ratio", String(next));
    };
    const end = () => {
      divider.removeEventListener("pointermove", move);
      divider.removeEventListener("pointerup", end);
      divider.removeEventListener("pointercancel", end);
      setSplitRatio(next);
    };
    divider.addEventListener("pointermove", move);
    divider.addEventListener("pointerup", end);
    divider.addEventListener("pointercancel", end);
  };
  const resizeWithKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta =
      event.key === "ArrowLeft"
        ? -KEYBOARD_RESIZE_STEP
        : event.key === "ArrowRight"
          ? KEYBOARD_RESIZE_STEP
          : 0;
    if (delta === 0) return;
    event.preventDefault();
    setSplitRatio(clampToContainer(props.ratio + delta));
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize split view"
      aria-valuenow={Math.round(props.ratio * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      tabIndex={0}
      className="relative z-10 w-px shrink-0 cursor-col-resize touch-none bg-border outline-none before:absolute before:inset-y-0 before:-right-1 before:-left-1 before:content-[''] hover:bg-ring/60 focus-visible:bg-ring"
      onPointerDown={startDrag}
      onDoubleClick={() => setSplitRatio(DEFAULT_SPLIT_RATIO)}
      onKeyDown={resizeWithKeys}
    />
  );
}

/**
 * The second pane: a full chat for one server thread. Its thread's right panel and terminal
 * drawer show only in the main pane, so opening either here moves the thread there.
 */
function SecondaryThreadPane(props: {
  readonly threadKey: string;
  readonly threadRef: ScopedThreadRef;
  readonly background: boolean;
  readonly inactive: boolean;
}) {
  const { threadKey } = props;
  const router = useRouter();
  const composerRef = useRef<ChatComposerHandle | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- publishes which thread the second pane renders, for keyboard commands and the palette that read it at event time
  useLayoutEffect(() => {
    useThreadTabsStore.getState().setShownSplit(threadKey);
    return () => useThreadTabsStore.getState().setShownSplit(null);
  }, [threadKey]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to the panel and terminal stores so opening either for this pane's thread moves it to the main pane
  useEffect(() => {
    const unsubscribePanel = useRightPanelStore.subscribe((state, previous) => {
      if (opensRightPanel(previous.byThreadKey[threadKey], state.byThreadKey[threadKey])) {
        swapThreadPanes(router);
      }
    });
    const unsubscribeTerminal = useTerminalUiStateStore.subscribe((state, previous) => {
      if (
        opensTerminalDrawer(
          previous.terminalUiStateByThreadKey[threadKey],
          state.terminalUiStateByThreadKey[threadKey],
        )
      ) {
        swapThreadPanes(router);
      }
    });
    return () => {
      unsubscribePanel();
      unsubscribeTerminal();
    };
  }, [router, threadKey]);

  return (
    <div
      data-thread-pane="secondary"
      className="flex min-h-0 min-w-0 flex-1 flex-col [contain:layout]"
      onPointerDownCapture={() => focusPane("secondary")}
      onFocusCapture={() => focusPane("secondary")}
    >
      <BackgroundThreadContext value={props.background || props.inactive}>
        <InactiveThreadPaneContext value={props.inactive}>
          <ComposerHandleContext value={composerRef}>
            <ChatView
              environmentId={props.threadRef.environmentId}
              threadId={props.threadRef.threadId}
              routeKind="server"
              secondaryPane={{ promote: () => swapThreadPanes(router) }}
            />
          </ComposerHandleContext>
        </InactiveThreadPaneContext>
      </BackgroundThreadContext>
    </div>
  );
}
