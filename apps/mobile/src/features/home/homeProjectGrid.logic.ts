import {
  NO_HOME_BADGES,
  searchHomeProjects,
  type HomeProjectBadges,
} from "@t3tools/client-runtime/home-projects";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { isListedThreadLineage, type EnvironmentId } from "@t3tools/contracts";

import { scopedProjectKey } from "../../lib/scopedEntities";
import { resolveThreadListV2Status, threadHasUnseenCompletion } from "../threads/threadListV2";
import type { HomeProjectScope } from "./homeThreadList";

export interface HomeGridProject {
  /** The project scope key, which is also the thread list's project filter. */
  readonly key: string;
  readonly displayName: string;
  readonly representative: EnvironmentProject;
  readonly pinned: boolean;
  readonly memberProjects: ReadonlyArray<{
    readonly title: string;
    readonly workspaceRoot: string;
    readonly environmentLabel: string | null;
  }>;
  readonly badges: HomeProjectBadges;
  readonly hasThreads: boolean;
}

/**
 * Tiles for the open, non-scratch scopes in the order given, best search match first when
 * there is a query. Threads listed under a parent add no attention or work.
 */
export function buildHomeGridProjects(input: {
  readonly scopes: ReadonlyArray<HomeProjectScope>;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly runningProjectKeys: ReadonlySet<string>;
  readonly environmentLabel: (environmentId: EnvironmentId) => string | null;
  readonly query: string;
}): ReadonlyArray<HomeGridProject> {
  const scopeKeyByProject = new Map<string, string>();
  for (const scope of input.scopes) {
    for (const ref of scope.projectRefs) {
      scopeKeyByProject.set(scopedProjectKey(ref.environmentId, ref.projectId), scope.key);
    }
  }
  const badges = new Map<string, HomeProjectBadges>();
  const withThreads = new Set<string>();
  const update = (key: string, change: (current: HomeProjectBadges) => HomeProjectBadges) =>
    badges.set(key, change(badges.get(key) ?? NO_HOME_BADGES));
  for (const projectKey of input.runningProjectKeys) {
    const key = scopeKeyByProject.get(projectKey);
    if (key !== undefined) update(key, (current) => ({ ...current, appRunning: true }));
  }
  for (const thread of input.threads) {
    if (thread.archivedAt !== null || !isListedThreadLineage(thread.lineage)) continue;
    const key = scopeKeyByProject.get(scopedProjectKey(thread.environmentId, thread.projectId));
    if (key === undefined) continue;
    withThreads.add(key);
    const status = resolveThreadListV2Status(thread);
    const needsUser =
      status === "approval" ||
      status === "input" ||
      status === "request" ||
      (status === "ready" && threadHasUnseenCompletion(thread));
    const working = status === "working";
    if (!needsUser && !working) continue;
    update(key, (current) => ({
      ...current,
      attention: current.attention + (needsUser ? 1 : 0),
      working: current.working || working,
    }));
  }

  const projects = input.scopes
    .filter((scope) => !scope.archived && !scope.representative.isScratch)
    .map((scope): HomeGridProject => ({
      key: scope.key,
      displayName: scope.title,
      representative: scope.representative,
      pinned: scope.pinned,
      memberProjects: scope.projects.map((project) => ({
        title: project.title,
        workspaceRoot: project.workspaceRoot,
        environmentLabel: input.environmentLabel(project.environmentId),
      })),
      badges: badges.get(scope.key) ?? NO_HOME_BADGES,
      hasThreads: withThreads.has(scope.key),
    }));
  return searchHomeProjects(projects, input.query);
}

/** Columns that keep tiles at least `minTileWidth` wide. */
export function homeGridColumns(width: number, minTileWidth: number): number {
  return Math.max(3, Math.floor(width / minTileWidth));
}
