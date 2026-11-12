import type { EnvironmentId, ScopedProjectRef, ThreadId } from "@t3tools/contracts";

import type { SidebarThreadSummary } from "../../types";

const projectRefKey = (ref: { readonly environmentId: string; readonly projectId: string }) =>
  `${ref.environmentId}:${ref.projectId}`;

/** The Home group holding the project, whose members' threads the screen lists together. */
export function findProjectGroup<
  T extends { readonly memberProjectRefs: ReadonlyArray<ScopedProjectRef> },
>(groups: readonly T[], ref: ScopedProjectRef): T | null {
  const key = projectRefKey(ref);
  return (
    groups.find((group) =>
      group.memberProjectRefs.some((member) => projectRefKey(member) === key),
    ) ?? null
  );
}

export type ProjectActivityKind = "created" | "working" | "completed" | "failed" | "stopped";

export interface ProjectActivityEntry {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly title: string;
  readonly kind: ProjectActivityKind;
  readonly at: string;
}

type ActivityThread = Pick<
  SidebarThreadSummary,
  "environmentId" | "id" | "title" | "createdAt" | "latestRun"
>;

function latestRunActivity(run: NonNullable<ActivityThread["latestRun"]>): {
  readonly kind: ProjectActivityKind;
  readonly at: string | null;
} {
  switch (run.status) {
    case "completed":
      return { kind: "completed", at: run.completedAt };
    case "failed":
      return { kind: "failed", at: run.completedAt };
    case "interrupted":
    case "cancelled":
    case "rolled_back":
      return { kind: "stopped", at: run.completedAt };
    default:
      return { kind: "working", at: run.startedAt ?? run.requestedAt };
  }
}

/** Newest first: each thread's start and how its latest run went. */
export function deriveProjectActivity(
  threads: ReadonlyArray<ActivityThread>,
  limit: number,
): ProjectActivityEntry[] {
  const entries: Array<ProjectActivityEntry & { readonly time: number }> = [];
  const push = (thread: ActivityThread, kind: ProjectActivityKind, at: string | null) => {
    const time = at === null ? Number.NaN : Date.parse(at);
    if (Number.isNaN(time)) return;
    entries.push({
      key: `${thread.environmentId}:${thread.id}:${kind}`,
      environmentId: thread.environmentId,
      threadId: thread.id,
      title: thread.title,
      kind,
      at: at!,
      time,
    });
  };
  for (const thread of threads) {
    push(thread, "created", thread.createdAt);
    if (thread.latestRun) {
      const run = latestRunActivity(thread.latestRun);
      push(thread, run.kind, run.at);
    }
  }
  return entries
    .toSorted((left, right) => right.time - left.time)
    .slice(0, limit)
    .map(({ time: _time, ...entry }) => entry);
}

export interface RunningAppThread {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  /** Set when an unsent draft runs the app; it opens through its draft route. */
  readonly draftId: string | null;
}

/** The thread whose Run is up, so the screen can show and open its server. */
export function findRunningAppThread(input: {
  readonly refs: ReadonlyArray<ScopedProjectRef>;
  /** Newest first, so the latest run wins. */
  readonly threads: ReadonlyArray<Pick<SidebarThreadSummary, "environmentId" | "id" | "projectId">>;
  readonly drafts: Readonly<
    Record<
      string,
      {
        readonly environmentId: EnvironmentId;
        readonly threadId: ThreadId;
        readonly projectId: string;
      }
    >
  >;
  readonly appRunningThreadKeys: ReadonlySet<string>;
}): RunningAppThread | null {
  if (input.appRunningThreadKeys.size === 0) return null;
  const projectKeys = new Set(input.refs.map(projectRefKey));
  const thread = input.threads.find(
    (candidate) =>
      projectKeys.has(projectRefKey(candidate)) &&
      input.appRunningThreadKeys.has(`${candidate.environmentId}:${candidate.id}`),
  );
  if (thread) return { environmentId: thread.environmentId, threadId: thread.id, draftId: null };
  for (const [draftId, draft] of Object.entries(input.drafts)) {
    if (
      projectKeys.has(projectRefKey(draft)) &&
      input.appRunningThreadKeys.has(`${draft.environmentId}:${draft.threadId}`)
    ) {
      return { environmentId: draft.environmentId, threadId: draft.threadId, draftId };
    }
  }
  return null;
}
