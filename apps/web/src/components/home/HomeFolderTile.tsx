import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { memo } from "react";

import { cn } from "../../lib/utils";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import type { HomeFolder } from "../../uiStateStore";
import { MiddleTruncate } from "../ui/middle-truncate";
import {
  contextMenuPosition,
  HOME_GROUPING_TARGET_CLASS,
  HomeProjectIcon,
  RunningDot,
  TILE_BUTTON_CLASS,
} from "./HomeProjectTile";
import { formatHomeBadgeCount, homeProjectAccessibleName } from "./homeScreen.logic";

/** Light glass, clearly above the page in both themes; folders and their open panel share it. */
export const HOME_GLASS_CLASS =
  "border border-white/50 bg-white/45 shadow-md shadow-black/10 backdrop-blur-xl dark:border-white/15 dark:bg-white/10";

/**
 * The members as a 2×2 grid, or 3×3 past four, filling about 80% of the tile. Each mini
 * keeps a real tile's corner ratio (a fifth to a quarter of its width).
 */
function HomeFolderGlyph(props: { readonly projects: readonly SidebarProjectSnapshot[] }) {
  const large = props.projects.length > 4;
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-full content-start p-2 sm:p-2.5",
        large ? "grid-cols-3 gap-1 sm:gap-1.5" : "grid-cols-2 gap-1.5 sm:gap-2",
      )}
    >
      {props.projects.slice(0, large ? 9 : 4).map((project) => (
        <span
          key={project.projectKey}
          className={cn(
            "flex aspect-square overflow-hidden",
            large ? "rounded-sm sm:rounded-md" : "rounded-md sm:rounded-lg",
          )}
        >
          <HomeProjectIcon project={project} size="mini" attention={0} working={false} />
        </span>
      ))}
    </span>
  );
}

export const HomeFolderTile = memo(function HomeFolderTile(props: {
  readonly entryKey: string;
  readonly folder: HomeFolder;
  readonly projects: readonly SidebarProjectSnapshot[];
  readonly attention: number;
  readonly working: boolean;
  readonly appRunning: boolean;
  readonly dragDisabled: boolean;
  readonly groupingTarget: boolean;
  readonly onOpen: (folderId: string) => void;
  readonly onContextMenu: (
    folder: HomeFolder,
    position: { readonly x: number; readonly y: number },
  ) => void;
}) {
  const { folder } = props;
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.entryKey, disabled: props.dragDisabled });
  return (
    <li
      ref={setNodeRef}
      className={cn("flex justify-center", isDragging && "relative z-10")}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...(props.dragDisabled ? {} : attributes)}
        {...listeners}
        aria-haspopup="dialog"
        aria-label={homeProjectAccessibleName(
          `${folder.name} folder, ${props.projects.length} projects`,
          props,
        )}
        className={cn(
          TILE_BUTTON_CLASS,
          "w-24 gap-2 sm:w-28",
          props.groupingTarget && HOME_GROUPING_TARGET_CLASS,
        )}
        onClick={() => props.onOpen(folder.id)}
        onContextMenu={(event) => {
          event.preventDefault();
          props.onContextMenu(folder, contextMenuPosition(event));
        }}
      >
        <span
          className={cn(
            HOME_GLASS_CLASS,
            "relative flex size-20 shrink-0 rounded-2xl motion-safe:transition-[scale] motion-safe:duration-150 group-hover/home-tile:scale-[1.04] sm:size-24 sm:rounded-3xl",
          )}
        >
          <HomeFolderGlyph projects={props.projects} />
          {props.working ? (
            <span
              aria-hidden
              className="absolute -top-1 -left-1 size-3 rounded-full bg-info ring-2 ring-background"
            />
          ) : null}
          {props.attention > 0 ? (
            <span
              aria-hidden
              className="absolute -top-1.5 -right-1.5 flex h-5.5 min-w-5.5 items-center justify-center rounded-full bg-destructive px-1.5 text-xs font-semibold text-white tabular-nums ring-2 ring-background"
            >
              {formatHomeBadgeCount(props.attention)}
            </span>
          ) : null}
        </span>
        <span className="flex w-full justify-center text-sm font-medium text-foreground">
          <MiddleTruncate value={folder.name} />
        </span>
        <RunningDot appRunning={props.appRunning} />
      </button>
    </li>
  );
});
