import type { ScopedProjectRef } from "@t3tools/contracts";

import type { ThreadTab } from "../../threadTabs.logic";
import type { SidebarThreadSummary } from "../../types";
import {
  filterSidebarV2VisibleThreads,
  hasUnseenCompletion,
  hasUnseenFailure,
  resolveSidebarThreadStatus,
  resolveThreadLastVisitedAt,
} from "../Sidebar.logic";

/** The one static mark a tab or project shows, most urgent first. */
export type ThreadMark = "needs-you" | "error" | "working" | "done";

const MARK_ORDER: readonly ThreadMark[] = ["needs-you", "error", "working", "done"];

export const THREAD_MARK_LABEL: Record<ThreadMark, string> = {
  "needs-you": "Needs you",
  error: "Failed",
  working: "Working",
  done: "Done",
};

type MarkThread = Parameters<typeof resolveSidebarThreadStatus>[0] &
  Parameters<typeof hasUnseenCompletion>[0];

/** `thread.lastVisitedAt` must already merge the local visit; see `withLocalVisit`. */
export function resolveThreadMark(thread: MarkThread): ThreadMark | null {
  const status = resolveSidebarThreadStatus(thread);
  if (status === "approval" || status === "input" || status === "request") return "needs-you";
  if (status === "preparing" || status === "working") return "working";
  if ((status === "failed" || status === "limited") && hasUnseenFailure(thread)) return "error";
  // Waiting threads stay quiet, as on Home; only a settled one reads as done.
  if (status === "ready" && hasUnseenCompletion(thread)) return "done";
  return null;
}

export function withLocalVisit<
  T extends Pick<SidebarThreadSummary, "environmentId" | "id" | "lastVisitedAt">,
>(thread: T, localLastVisitedAtById: Readonly<Record<string, string>>): T {
  return {
    ...thread,
    lastVisitedAt: resolveThreadLastVisitedAt(
      thread.lastVisitedAt,
      localLastVisitedAtById[`${thread.environmentId}:${thread.id}`],
    ),
  };
}

export type ThreadMarkCounts = Readonly<Record<ThreadMark, number>>;

const NO_MARKS: ThreadMarkCounts = { "needs-you": 0, error: 0, working: 0, done: 0 };

export function strongestThreadMark(counts: ThreadMarkCounts): ThreadMark | null {
  return MARK_ORDER.find((mark) => counts[mark] > 0) ?? null;
}

export function describeThreadMarkCounts(counts: ThreadMarkCounts): string {
  return MARK_ORDER.filter((mark) => counts[mark] > 0)
    .map((mark) => `${counts[mark]} ${THREAD_MARK_LABEL[mark].toLowerCase()}`)
    .join(" · ");
}

interface MarkProject {
  readonly projectKey: string;
  readonly memberProjectRefs: ReadonlyArray<ScopedProjectRef>;
}

type SummaryThread = MarkThread &
  Pick<
    SidebarThreadSummary,
    "archivedAt" | "environmentId" | "id" | "lineage" | "projectId" | "lastVisitedAt"
  >;

export interface WaitingThread<T> {
  readonly projectKey: string;
  readonly thread: T;
  readonly mark: Exclude<ThreadMark, "working">;
}

const projectRefKey = (ref: { readonly environmentId: string; readonly projectId: string }) =>
  `${ref.environmentId}:${ref.projectId}`;

function projectKeyByRef(projects: ReadonlyArray<MarkProject>): Map<string, string> {
  const byRef = new Map<string, string>();
  for (const project of projects) {
    for (const ref of project.memberProjectRefs) byRef.set(projectRefKey(ref), project.projectKey);
  }
  return byRef;
}

/**
 * Mark counts per project, and the threads waiting on the user across every project.
 * Threads the sidebar lists under a parent count toward neither, as on Home.
 */
export function summarizeThreadMarks<T extends SummaryThread>(input: {
  readonly projects: ReadonlyArray<MarkProject>;
  readonly threads: readonly T[];
  readonly delegatedUnderParent: ReadonlySet<string>;
  readonly localLastVisitedAtById: Readonly<Record<string, string>>;
}): {
  readonly countsByProjectKey: ReadonlyMap<string, ThreadMarkCounts>;
  readonly waiting: ReadonlyArray<WaitingThread<T>>;
} {
  const projectKeys = projectKeyByRef(input.projects);
  const countsByProjectKey = new Map<string, ThreadMarkCounts>();
  const waiting: WaitingThread<T>[] = [];
  for (const thread of filterSidebarV2VisibleThreads(
    input.threads,
    null,
    input.delegatedUnderParent,
  )) {
    const projectKey = projectKeys.get(projectRefKey(thread));
    if (projectKey === undefined) continue;
    const mark = resolveThreadMark(withLocalVisit(thread, input.localLastVisitedAtById));
    if (mark === null) continue;
    const counts = countsByProjectKey.get(projectKey) ?? NO_MARKS;
    countsByProjectKey.set(projectKey, { ...counts, [mark]: counts[mark] + 1 });
    if (mark !== "working") waiting.push({ projectKey, thread, mark });
  }
  return { countsByProjectKey, waiting };
}

/** The shown tabs: a thread's while it exists unarchived, a draft's while it is unsent. */
export interface ShownThreadTab<T, P> {
  readonly key: string;
  readonly tab: ThreadTab;
  readonly thread: T | null;
  readonly title: string;
  readonly projectRef: ScopedProjectRef;
  readonly project: P | null;
}

export function deriveShownThreadTabs<
  T extends Pick<SidebarThreadSummary, "environmentId" | "projectId" | "title" | "archivedAt">,
  P extends MarkProject,
>(input: {
  readonly tabs: readonly ThreadTab[];
  readonly threadByKey: ReadonlyMap<string, T>;
  readonly drafts: Readonly<
    Record<string, Pick<ScopedProjectRef, "environmentId" | "projectId"> | undefined>
  >;
  readonly projects: readonly P[];
}): ShownThreadTab<T, P>[] {
  const projectKeys = projectKeyByRef(input.projects);
  const projectByKey = new Map(input.projects.map((project) => [project.projectKey, project]));
  const projectFor = (ref: ScopedProjectRef) => {
    const key = projectKeys.get(projectRefKey(ref));
    return key === undefined ? null : (projectByKey.get(key) ?? null);
  };
  return input.tabs.flatMap((tab): ShownThreadTab<T, P>[] => {
    if (tab.target.kind === "thread") {
      const thread = input.threadByKey.get(tab.key);
      if (!thread || thread.archivedAt !== null) return [];
      const projectRef = { environmentId: thread.environmentId, projectId: thread.projectId };
      return [
        {
          key: tab.key,
          tab,
          thread,
          title: thread.title,
          projectRef,
          project: projectFor(projectRef),
        },
      ];
    }
    const draft = input.drafts[tab.target.draftId];
    if (!draft) return [];
    const projectRef = { environmentId: draft.environmentId, projectId: draft.projectId };
    return [
      {
        key: tab.key,
        tab,
        thread: null,
        title: "New thread",
        projectRef,
        project: projectFor(projectRef),
      },
    ];
  });
}

/** A pane's tab bar lists only the tabs of the project its thread belongs to. */
export function projectThreadTabs<
  T extends {
    readonly key: string;
    readonly projectRef: ScopedProjectRef;
    readonly project: { readonly projectKey: string } | null;
  },
>(shown: readonly T[], activeKey: string | null): readonly T[] {
  const projectOf = (tab: T) => tab.project?.projectKey ?? projectRefKey(tab.projectRef);
  const active = shown.find((tab) => tab.key === activeKey);
  if (!active) return shown;
  const activeProject = projectOf(active);
  return shown.filter((tab) => projectOf(tab) === activeProject);
}

/**
 * The project bar: pinned projects in Home's dock order, then projects with a shown tab in
 * tab order, then projects with a thread working or waiting on the user.
 */
export function buildRailProjects<P extends { readonly projectKey: string }>(input: {
  readonly pinned: readonly P[];
  readonly projects: readonly P[];
  readonly tabProjectKeys: readonly string[];
  readonly busyProjectKeys: ReadonlySet<string>;
}): { readonly pinned: readonly P[]; readonly open: readonly P[] } {
  const listed = new Set(input.pinned.map((project) => project.projectKey));
  const byKey = new Map(input.projects.map((project) => [project.projectKey, project]));
  const open: P[] = [];
  const add = (project: P | undefined) => {
    if (!project || listed.has(project.projectKey)) return;
    listed.add(project.projectKey);
    open.push(project);
  };
  for (const key of input.tabProjectKeys) add(byKey.get(key));
  for (const project of input.projects) {
    if (input.busyProjectKeys.has(project.projectKey)) add(project);
  }
  return { pinned: input.pinned, open };
}
