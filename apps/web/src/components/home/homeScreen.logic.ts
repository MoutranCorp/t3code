import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  homeTileTintForColor,
  NO_HOME_BADGES,
  type HomeProjectBadges,
} from "@t3tools/client-runtime/home-projects";
import type { KnownTerminalSession } from "@t3tools/client-runtime/state/terminal";
import { sortThreads, type ThreadSortInput } from "@t3tools/client-runtime/state/thread-sort";
import type { EnvironmentId, ProjectIconOverride, ScopedProjectRef } from "@t3tools/contracts";
import type { SidebarThreadSortOrder } from "@t3tools/contracts/settings";

import { deriveProjectIdentity } from "../../projectIdentity";
import type { SidebarThreadSummary } from "../../types";
import { legacyProjectCwdPreferenceKey } from "../../uiStateStore";
import {
  deriveProjectRunPhase,
  type ProjectRun,
  type RunTerminalState,
} from "../chat/projectRunControl.logic";
import {
  filterSidebarV2VisibleThreads,
  hasUnseenCompletion,
  resolveSidebarThreadStatus,
  resolveThreadLastVisitedAt,
} from "../Sidebar.logic";

interface HomeProjectMember {
  readonly physicalProjectKey: string;
  readonly workspaceRoot: string;
  readonly title: string;
  readonly environmentLabel: string | null;
}

/** The parts of a sidebar project group Home reads. */
export interface HomeProject {
  readonly projectKey: string;
  readonly displayName: string;
  readonly title: string;
  readonly archived: boolean;
  readonly pinned: boolean;
  readonly isScratch?: true | undefined;
  readonly projectIcon?: ProjectIconOverride | null | undefined;
  readonly memberProjects: ReadonlyArray<HomeProjectMember>;
  readonly memberProjectRefs: ReadonlyArray<ScopedProjectRef>;
}

const projectRefKey = (ref: { readonly environmentId: string; readonly projectId: string }) =>
  `${ref.environmentId}:${ref.projectId}`;

function homeOrderKeys(project: Pick<HomeProject, "memberProjects">): string[] {
  return project.memberProjects.flatMap((member) => [
    member.physicalProjectKey,
    legacyProjectCwdPreferenceKey(member.workspaceRoot),
  ]);
}

/**
 * Projects in their saved order, then the rest in the order given (most recently
 * updated first). Archived and scratch projects have no tile.
 */
export function orderHomeProjects<
  T extends Pick<HomeProject, "archived" | "isScratch" | "memberProjects">,
>(projectsByRecency: readonly T[], projectOrder: readonly string[]): T[] {
  const savedIndex = new Map<string, number>();
  for (const [index, key] of projectOrder.entries()) {
    if (!savedIndex.has(key)) savedIndex.set(key, index);
  }
  const ranked = projectsByRecency
    .filter((project) => !project.archived && !project.isScratch)
    .map((project) => ({
      project,
      rank: Math.min(
        ...homeOrderKeys(project).map((key) => savedIndex.get(key) ?? Number.POSITIVE_INFINITY),
      ),
    }));
  return [
    ...ranked
      .filter(({ rank }) => Number.isFinite(rank))
      .toSorted((left, right) => left.rank - right.rank),
    ...ranked.filter(({ rank }) => !Number.isFinite(rank)),
  ].map(({ project }) => project);
}

/**
 * Arguments for `reorderProjects` that move one tile onto another's slot. Every
 * shown project is written, so the new order no longer depends on recency.
 */
export function planHomeReorder(
  projects: ReadonlyArray<Pick<HomeProject, "projectKey" | "memberProjects">>,
  projectOrder: readonly string[],
  activeKey: string,
  overKey: string,
): {
  readonly currentOrder: string[];
  readonly dragged: string[];
  readonly target: string[];
} | null {
  const from = projects.findIndex((project) => project.projectKey === activeKey);
  const to = projects.findIndex((project) => project.projectKey === overKey);
  if (from < 0 || to < 0 || from === to) return null;
  const memberKeys = (index: number) =>
    projects[index]!.memberProjects.map((member) => member.physicalProjectKey);
  const shown = projects.flatMap((_, index) => memberKeys(index));
  const shownSet = new Set(shown);
  const targetKeys = memberKeys(to);
  // reorderProjects drops a forward move after its target and a backward move before it.
  const target = from < to ? targetKeys.at(-1) : targetKeys[0];
  if (target === undefined) return null;
  return {
    currentOrder: [...shown, ...projectOrder.filter((key) => !shownSet.has(key))],
    dragged: memberKeys(from),
    target: [target],
  };
}

export {
  formatHomeBadgeCount,
  homeDockProjects,
  homeProjectAccessibleName,
  NO_HOME_BADGES,
  searchHomeProjects,
  type HomeProjectBadges,
} from "@t3tools/client-runtime/home-projects";

/**
 * The tile's colour: the configured icon colour, else the colour the monogram
 * fallback derives from the project name, so a fallback glyph matches its tile.
 */
export function homeTileTint(project: Pick<HomeProject, "title" | "projectIcon">): {
  readonly hue: number;
  readonly chroma: number;
} {
  const icon = project.projectIcon;
  return homeTileTintForColor(
    icon?.kind === "monogram" || icon?.kind === "lucide"
      ? icon.color
      : deriveProjectIdentity(project.title).color,
  );
}

type HomeBadgeThread = Parameters<typeof resolveSidebarThreadStatus>[0] &
  Parameters<typeof hasUnseenCompletion>[0] &
  Pick<SidebarThreadSummary, "archivedAt" | "environmentId" | "id" | "lineage" | "projectId">;

type RunTerminalSession = {
  readonly target: Pick<KnownTerminalSession["target"], "threadId" | "terminalId">;
  readonly state: RunTerminalState;
};

/**
 * Threads whose app is starting or running. Without terminal metadata for an
 * environment (loading, or no read access) a run counts once it was seen running.
 */
export function resolveAppRunningThreadKeys(
  runsByThreadKey: Readonly<Record<string, Readonly<Record<string, ProjectRun>>>>,
  sessionsByEnvironment: ReadonlyMap<EnvironmentId, ReadonlyArray<RunTerminalSession> | null>,
): Set<string> {
  const running = new Set<string>();
  for (const [threadKey, runs] of Object.entries(runsByThreadKey)) {
    const threadRef = parseScopedThreadKey(threadKey);
    if (threadRef === null) continue;
    const sessions = sessionsByEnvironment.get(threadRef.environmentId) ?? null;
    const terminals =
      sessions === null
        ? null
        : new Map(
            sessions
              .filter((session) => session.target.threadId === threadRef.threadId)
              .map((session) => [session.target.terminalId, session.state] as const),
          );
    const active = Object.values(runs).some((run) => {
      const phase = deriveProjectRunPhase(run, terminals);
      return phase === "starting" || phase === "running";
    });
    if (active) running.add(threadKey);
  }
  return running;
}

/** Badges per project key. Threads the sidebar lists under a parent add no attention or work. */
export function summarizeHomeBadges(input: {
  readonly projects: ReadonlyArray<Pick<HomeProject, "projectKey" | "memberProjectRefs">>;
  readonly threads: ReadonlyArray<HomeBadgeThread>;
  readonly delegatedUnderParent: ReadonlySet<string>;
  readonly localLastVisitedAtById: Readonly<Record<string, string>>;
  readonly appRunningThreadKeys: ReadonlySet<string>;
  /** Unsent drafts, which can run an app before they have a thread. */
  readonly draftThreads: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly threadId: string;
    readonly projectId: string;
  }>;
}): Map<string, HomeProjectBadges> {
  const projectKeyByRef = new Map<string, string>();
  for (const project of input.projects) {
    for (const ref of project.memberProjectRefs) {
      projectKeyByRef.set(projectRefKey(ref), project.projectKey);
    }
  }
  const badges = new Map<string, HomeProjectBadges>();
  const update = (projectKey: string, change: (badges: HomeProjectBadges) => HomeProjectBadges) =>
    badges.set(projectKey, change(badges.get(projectKey) ?? NO_HOME_BADGES));

  for (const draft of input.draftThreads) {
    const projectKey = projectKeyByRef.get(projectRefKey(draft));
    if (projectKey === undefined) continue;
    if (input.appRunningThreadKeys.has(`${draft.environmentId}:${draft.threadId}`)) {
      update(projectKey, (current) => ({ ...current, appRunning: true }));
    }
  }

  const listed = new Set(
    filterSidebarV2VisibleThreads(input.threads, null, input.delegatedUnderParent),
  );
  for (const thread of input.threads) {
    const projectKey = projectKeyByRef.get(projectRefKey(thread));
    if (projectKey === undefined) continue;
    const threadKey = scopedThreadKey({ environmentId: thread.environmentId, threadId: thread.id });
    // A run belongs to its project whichever thread started it.
    if (input.appRunningThreadKeys.has(threadKey)) {
      update(projectKey, (current) => ({ ...current, appRunning: true }));
    }
    if (!listed.has(thread)) continue;
    const status = resolveSidebarThreadStatus(thread);
    const needsUser =
      status === "approval" ||
      status === "input" ||
      status === "request" ||
      // Waiting and failed threads say so on their own rows; only a settled one reads as done.
      (status === "ready" &&
        hasUnseenCompletion({
          ...thread,
          lastVisitedAt: resolveThreadLastVisitedAt(
            thread.lastVisitedAt,
            input.localLastVisitedAtById[threadKey],
          ),
        }));
    const working = status === "preparing" || status === "working";
    if (!needsUser && !working) continue;
    update(projectKey, (current) => ({
      ...current,
      attention: current.attention + (needsUser ? 1 : 0),
      working: current.working || working,
    }));
  }
  return badges;
}

/** The project's most recent listed thread, the one its tile opens. */
export function latestHomeThread<
  T extends Pick<
    SidebarThreadSummary,
    "archivedAt" | "environmentId" | "id" | "lineage" | "projectId"
  > &
    ThreadSortInput,
>(
  project: Pick<HomeProject, "memberProjectRefs">,
  threads: readonly T[],
  delegatedUnderParent: ReadonlySet<string>,
  sortOrder: SidebarThreadSortOrder,
): T | null {
  const projectKeys = new Set(project.memberProjectRefs.map(projectRefKey));
  return (
    sortThreads(
      filterSidebarV2VisibleThreads(threads, projectKeys, delegatedUnderParent),
      sortOrder,
    )[0] ?? null
  );
}
