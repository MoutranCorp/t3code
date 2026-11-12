import type { ProjectIconColor } from "@t3tools/contracts";
import { foldSearchQuery, rankSearchItems, scoreSearchTerms } from "@t3tools/shared/paletteSearch";

interface HomeSearchProject {
  readonly displayName: string;
  readonly memberProjects: ReadonlyArray<{
    readonly title: string;
    readonly workspaceRoot: string;
    readonly environmentLabel: string | null;
  }>;
}

export interface HomeProjectBadges {
  /** Threads waiting on the user, plus finished threads they have not opened. */
  readonly attention: number;
  readonly working: boolean;
  readonly appRunning: boolean;
}

export const NO_HOME_BADGES: HomeProjectBadges = {
  attention: 0,
  working: false,
  appRunning: false,
};

export function homeDockProjects<T extends { readonly pinned: boolean }>(
  projects: readonly T[],
): T[] {
  return projects.filter((project) => project.pinned);
}

function homeSearchTerms(project: HomeSearchProject): string[] {
  return [
    project.displayName,
    ...project.memberProjects.flatMap((member) => [
      member.title,
      member.workspaceRoot,
      ...(member.environmentLabel === null ? [] : [member.environmentLabel]),
    ]),
  ];
}

/** Best match first; every project when the query is empty. */
export function searchHomeProjects<T extends HomeSearchProject>(
  projects: readonly T[],
  query: string,
): readonly T[] {
  const folded = foldSearchQuery(query);
  if (folded.length === 0) return projects;
  return rankSearchItems(projects, (project, options) =>
    scoreSearchTerms(folded, homeSearchTerms(project), options),
  ).map(({ item }) => item);
}

// Approximate oklch hues of the Tailwind palette the project icon colours come from.
const PROJECT_ICON_HUES: Record<ProjectIconColor, number> = {
  gray: 260,
  red: 25,
  orange: 47,
  amber: 70,
  yellow: 86,
  lime: 131,
  green: 150,
  emerald: 163,
  teal: 182,
  cyan: 215,
  sky: 237,
  blue: 259,
  indigo: 277,
  violet: 293,
  purple: 304,
  fuchsia: 322,
  pink: 354,
  rose: 16,
};

export function homeTileTintForColor(color: ProjectIconColor): {
  readonly hue: number;
  readonly chroma: number;
} {
  return { hue: PROJECT_ICON_HUES[color], chroma: color === "gray" ? 0.02 : 0.15 };
}

function oklchToHex(lightness: number, chroma: number, hueDegrees: number): string {
  const hue = (hueDegrees * Math.PI) / 180;
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return `#${linear
    .map((channel) => {
      const encoded = channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;
      const byte = Math.round(Math.min(1, Math.max(0, encoded)) * 255);
      return byte.toString(16).padStart(2, "0");
    })
    .join("")}`;
}

/** The tile gradient's stops as sRGB hex, for clients without oklch colours. */
export function homeTileGradient(tint: { readonly hue: number; readonly chroma: number }): {
  readonly from: string;
  readonly to: string;
} {
  // Dark enough at the light end that a white glyph keeps 3:1 on every hue, in both themes.
  return {
    from: oklchToHex(0.62, tint.chroma, tint.hue),
    to: oklchToHex(0.42, tint.chroma * 0.9, tint.hue + 12),
  };
}

export function formatHomeBadgeCount(count: number): string {
  return count > 9 ? "9+" : String(count);
}

export function homeProjectAccessibleName(name: string, badges: HomeProjectBadges): string {
  return [
    name,
    ...(badges.attention > 0
      ? [`${badges.attention} ${badges.attention === 1 ? "needs" : "need"} attention`]
      : []),
    ...(badges.working ? ["working"] : []),
    ...(badges.appRunning ? ["app running"] : []),
  ].join(", ");
}
