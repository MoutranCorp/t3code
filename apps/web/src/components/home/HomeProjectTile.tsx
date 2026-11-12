import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useAtomValue } from "@effect/atom-react";
import { generatedProjectIconSvg } from "@t3tools/shared/generatedProjectIcon";
import { isProjectFaviconFallbackUrl } from "@t3tools/shared/projectFavicon";
import { FolderCodeIcon } from "lucide-react";
import { createElement, lazy, memo, Suspense, type CSSProperties, type MouseEvent } from "react";

import { cn } from "../../lib/utils";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { projectFaviconUrlAtom } from "../../state/assets";
import { ProjectFavicon } from "../ProjectFavicon";
import { ProjectIconSvgImage } from "../ProjectIconSvgImage";
import { MiddleTruncate } from "../ui/middle-truncate";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { formatHomeBadgeCount, homeProjectAccessibleName, homeTileTint } from "./homeScreen.logic";
import { useProjectIconGenerating } from "./useProjectIconActions";

interface HomeProjectTileProps {
  readonly project: SidebarProjectSnapshot;
  readonly attention: number;
  readonly working: boolean;
  readonly appRunning: boolean;
  readonly onOpen: (project: SidebarProjectSnapshot) => void;
  readonly onContextMenu: (
    project: SidebarProjectSnapshot,
    position: { readonly x: number; readonly y: number },
  ) => void;
}

export const HOME_GROUPING_TARGET_CLASS = "bg-foreground/10 ring-2 ring-primary/50 ring-inset";

export const TILE_BUTTON_CLASS =
  "group/home-tile flex cursor-pointer flex-col items-center rounded-3xl p-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";

/** A keyboard-opened menu reports (0, 0), so it opens under the element instead. */
export function contextMenuPosition(event: MouseEvent<HTMLElement>) {
  if (event.clientX !== 0 || event.clientY !== 0) return { x: event.clientX, y: event.clientY };
  const rect = event.currentTarget.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.bottom };
}

const monogramSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

// All lucide icons load as one chunk, only once a project uses a lucide override.
const LucideGlyph = lazy(() =>
  import("../../lib/lucideIconByName").then(({ lucideIconByName }) => ({
    default: function LucideGlyph(props: { name: string; className: string }) {
      return createElement(lucideIconByName(props.name) ?? FolderCodeIcon, {
        className: props.className,
      });
    },
  })),
);

function MonogramGlyph(props: { readonly text: string }) {
  const graphemes = Array.from(monogramSegmenter.segment(props.text)).length;
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="size-1/2 overflow-visible select-none">
      <text
        x="8"
        y="11.3"
        textAnchor="middle"
        fill="currentColor"
        fontSize="9.5"
        fontWeight="700"
        textLength={graphemes === 1 ? 7 : 15}
        lengthAdjust="spacingAndGlyphs"
        textRendering="geometricPrecision"
      >
        {props.text}
      </text>
    </svg>
  );
}

const DRAWN_GLYPH_CLASS = "size-[70%] drop-shadow-xs";

/** A repo favicon keeps its own colours; without one a glyph drawn from the name stands in. */
function AutomaticGlyph(props: { readonly project: SidebarProjectSnapshot }) {
  const { project } = props;
  const src = useAtomValue(
    projectFaviconUrlAtom({
      environmentId: project.environmentId,
      cwd: project.workspaceRoot,
      faviconPath: project.faviconPath,
    }),
  );
  if (src && !isProjectFaviconFallbackUrl(src)) {
    return <ProjectFavicon project={project} className="size-[56%]" />;
  }
  return (
    <ProjectIconSvgImage
      svg={generatedProjectIconSvg(project.title)}
      className={DRAWN_GLYPH_CLASS}
    />
  );
}

function TileGlyph(props: { readonly project: SidebarProjectSnapshot; readonly size: TileSize }) {
  const icon = props.project.projectIcon;
  if (icon?.kind === "monogram") return <MonogramGlyph text={icon.text} />;
  if (icon?.kind === "svg") {
    return <ProjectIconSvgImage svg={icon.svg} className={DRAWN_GLYPH_CLASS} />;
  }
  if (icon?.kind === "lucide") {
    return (
      <Suspense fallback={<FolderCodeIcon aria-hidden className="size-1/2" />}>
        <LucideGlyph name={icon.name} className="size-1/2" />
      </Suspense>
    );
  }
  if (icon?.kind === "emoji") {
    return (
      <span
        aria-hidden
        className={cn(
          "leading-none select-none",
          props.size === "grid"
            ? "text-4xl sm:text-5xl"
            : props.size === "mini"
              ? "text-sm"
              : "text-3xl",
        )}
      >
        {icon.emoji}
      </span>
    );
  }
  return <AutomaticGlyph project={props.project} />;
}

type TileSize = "grid" | "dock" | "mini";

/** The gradient tile and glyph that stand for a project on Home and its project screen. */
export function HomeProjectIcon(props: {
  readonly project: SidebarProjectSnapshot;
  readonly size: TileSize;
  readonly attention: number;
  readonly working: boolean;
}) {
  const { hue, chroma } = homeTileTint(props.project);
  const generating = useProjectIconGenerating(props.project.projectKey);
  return (
    <span
      className={cn(
        "relative flex shrink-0 items-center justify-center bg-linear-to-br from-(--home-tile-from) to-(--home-tile-to) text-white ring-1 ring-white/15 ring-inset [&_svg]:drop-shadow-xs",
        props.size === "mini"
          ? "size-full rounded-lg shadow-xs shadow-black/20"
          : "shadow-md shadow-black/20 motion-safe:transition-[scale,filter] motion-safe:duration-150 group-hover/home-tile:scale-[1.04] group-hover/home-tile:brightness-110",
        props.size === "grid" && "size-20 rounded-2xl sm:size-24 sm:rounded-3xl",
        props.size === "dock" && "size-15 rounded-2xl",
      )}
      // Dark enough at the light end that a white glyph keeps 3:1 on every hue, in both themes.
      style={
        {
          "--home-tile-from": `oklch(0.62 ${chroma} ${hue})`,
          "--home-tile-to": `oklch(0.42 ${chroma * 0.9} ${hue + 12})`,
        } as CSSProperties
      }
    >
      <span
        className={cn("flex size-full items-center justify-center", generating && "opacity-40")}
      >
        <TileGlyph project={props.project} size={props.size} />
      </span>
      {generating && props.size === "grid" ? (
        <span className="absolute inset-x-0 bottom-2 text-center text-3xs font-medium text-white">
          Generating…
        </span>
      ) : null}
      {props.working ? (
        <span
          aria-hidden
          className={cn(
            "absolute rounded-full bg-info ring-2 ring-background",
            props.size === "grid" ? "-top-1 -left-1 size-3" : "-top-0.5 -left-0.5 size-2.5",
          )}
        />
      ) : null}
      {props.attention > 0 ? (
        <span
          aria-hidden
          className={cn(
            "absolute flex items-center justify-center rounded-full bg-destructive font-semibold text-white tabular-nums ring-2 ring-background",
            props.size === "grid"
              ? "-top-1.5 -right-1.5 h-5.5 min-w-5.5 px-1.5 text-xs"
              : "-top-1 -right-1 h-4.5 min-w-4.5 px-1 text-3xs",
          )}
        >
          {formatHomeBadgeCount(props.attention)}
        </span>
      ) : null}
    </span>
  );
}

export function RunningDot(props: { readonly appRunning: boolean }) {
  return (
    <span aria-hidden className="flex h-1.5 items-center">
      {props.appRunning ? <span className="size-1.5 rounded-full bg-success" /> : null}
    </span>
  );
}

export const HomeProjectTile = memo(function HomeProjectTile(
  props: HomeProjectTileProps & {
    readonly dragDisabled: boolean;
    /** A dragged tile hovers its middle, so dropping makes a folder. */
    readonly groupingTarget?: boolean;
  },
) {
  const { project } = props;
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: project.projectKey, disabled: props.dragDisabled });
  return (
    <li
      ref={setNodeRef}
      className={cn("flex justify-center", isDragging && "relative z-10")}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        // dnd-kit marks a disabled sortable aria-disabled, but the tile still opens.
        {...(props.dragDisabled ? {} : attributes)}
        {...listeners}
        aria-label={homeProjectAccessibleName(project.displayName, props)}
        className={cn(
          TILE_BUTTON_CLASS,
          "w-24 gap-2 sm:w-28",
          props.groupingTarget && HOME_GROUPING_TARGET_CLASS,
        )}
        onClick={() => props.onOpen(project)}
        onContextMenu={(event) => {
          event.preventDefault();
          props.onContextMenu(project, contextMenuPosition(event));
        }}
      >
        <HomeProjectIcon
          project={project}
          size="grid"
          attention={props.attention}
          working={props.working}
        />
        <span className="flex w-full justify-center text-sm font-medium text-foreground">
          <MiddleTruncate value={project.displayName} />
        </span>
        <RunningDot appRunning={props.appRunning} />
      </button>
    </li>
  );
});

export const HomeDockIcon = memo(function HomeDockIcon(props: HomeProjectTileProps) {
  const { project } = props;
  return (
    <li className="flex">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={homeProjectAccessibleName(project.displayName, props)}
              className={cn(TILE_BUTTON_CLASS, "gap-1")}
              onClick={() => props.onOpen(project)}
              onContextMenu={(event) => {
                event.preventDefault();
                props.onContextMenu(project, contextMenuPosition(event));
              }}
            />
          }
        >
          <HomeProjectIcon
            project={project}
            size="dock"
            attention={props.attention}
            working={props.working}
          />
          <RunningDot appRunning={props.appRunning} />
        </TooltipTrigger>
        <TooltipPopup side="top">{project.displayName}</TooltipPopup>
      </Tooltip>
    </li>
  );
});
