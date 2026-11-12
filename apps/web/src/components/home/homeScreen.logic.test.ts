import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type ProjectIconOverride,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadFixture, type ThreadFixtureOverrides } from "../../test-fixtures";
import { legacyProjectCwdPreferenceKey, reorderProjects } from "../../uiStateStore";
import type { ProjectRun } from "../chat/projectRunControl.logic";
import {
  formatHomeBadgeCount,
  homeDockProjects,
  homeProjectAccessibleName,
  homeTileTint,
  latestHomeThread,
  NO_HOME_BADGES,
  orderHomeProjects,
  planHomeReorder,
  resolveAppRunningThreadKeys,
  searchHomeProjects,
  summarizeHomeBadges,
} from "./homeScreen.logic";

const environmentId = EnvironmentId.make("environment-local");

function homeProject(
  name: string,
  overrides: {
    readonly archived?: boolean;
    readonly pinned?: boolean;
    readonly isScratch?: true;
    readonly projectIcon?: ProjectIconOverride | null;
    readonly workspaceRoots?: readonly string[];
  } = {},
) {
  const roots = overrides.workspaceRoots ?? [`/work/${name.toLowerCase()}`];
  return {
    projectKey: `${environmentId}:${roots[0]}`,
    displayName: name,
    title: name,
    archived: overrides.archived ?? false,
    pinned: overrides.pinned ?? false,
    isScratch: overrides.isScratch,
    projectIcon: overrides.projectIcon ?? null,
    memberProjects: roots.map((workspaceRoot) => ({
      physicalProjectKey: `${environmentId}:${workspaceRoot}`,
      workspaceRoot,
      title: name,
      environmentLabel: null,
    })),
    memberProjectRefs: roots.map((workspaceRoot) => ({
      environmentId,
      projectId: ProjectId.make(`project:${workspaceRoot}`),
    })),
  };
}

const names = (projects: ReadonlyArray<{ readonly displayName: string }>) =>
  projects.map((project) => project.displayName);

describe("orderHomeProjects", () => {
  it("puts saved projects first in saved order, then the rest by recency", () => {
    const [alpha, beta, gamma, delta] = ["Alpha", "Beta", "Gamma", "Delta"].map((name) =>
      homeProject(name),
    );
    const ordered = orderHomeProjects(
      [alpha!, beta!, gamma!, delta!],
      [gamma!.memberProjects[0]!.physicalProjectKey, "env:/gone", alpha!.projectKey],
    );
    expect(names(ordered)).toEqual(["Gamma", "Alpha", "Beta", "Delta"]);
  });

  it("reads legacy cwd keys and leaves out archived and scratch projects", () => {
    const projects = [
      homeProject("Alpha"),
      homeProject("Archived", { archived: true }),
      homeProject("Scratch", { isScratch: true }),
      homeProject("Beta"),
    ];
    const ordered = orderHomeProjects(projects, [legacyProjectCwdPreferenceKey("/work/beta")]);
    expect(names(ordered)).toEqual(["Beta", "Alpha"]);
  });

  it("ranks a grouped project by its earliest saved member", () => {
    const grouped = homeProject("Grouped", { workspaceRoots: ["/work/a", "/work/b"] });
    const other = homeProject("Other");
    const ordered = orderHomeProjects(
      [other, grouped],
      [other.projectKey, grouped.memberProjects[1]!.physicalProjectKey, `${environmentId}:/x`],
    );
    expect(names(ordered)).toEqual(["Other", "Grouped"]);
    expect(
      names(
        orderHomeProjects(
          [other, grouped],
          [grouped.memberProjects[1]!.physicalProjectKey, other.projectKey],
        ),
      ),
    ).toEqual(["Grouped", "Other"]);
  });
});

describe("planHomeReorder", () => {
  const applyMove = (
    projects: ReadonlyArray<ReturnType<typeof homeProject>>,
    savedOrder: readonly string[],
    activeKey: string,
    overKey: string,
  ) => {
    const plan = planHomeReorder(projects, savedOrder, activeKey, overKey);
    if (plan === null) return null;
    const next = reorderProjects(
      { projectOrder: [...savedOrder] } as Parameters<typeof reorderProjects>[0],
      plan.currentOrder,
      plan.dragged,
      plan.target,
    ).projectOrder;
    return { order: next, shown: names(orderHomeProjects(projects, next)) };
  };

  it("moves a tile forward and backward onto the target's slot", () => {
    const projects = ["A", "B", "C", "D"].map((name) => homeProject(name));
    const key = (index: number) => projects[index]!.projectKey;
    expect(applyMove(projects, [], key(0), key(2))?.shown).toEqual(["B", "C", "A", "D"]);
    expect(applyMove(projects, [], key(3), key(1))?.shown).toEqual(["A", "D", "B", "C"]);
  });

  it("keeps grouped members together and saved keys of hidden projects", () => {
    const projects = [
      homeProject("A"),
      homeProject("Grouped", { workspaceRoots: ["/work/g1", "/work/g2"] }),
      homeProject("C"),
    ];
    const hiddenKey = `${environmentId}:/work/archived`;
    const moved = applyMove(
      projects,
      [hiddenKey],
      projects[0]!.projectKey,
      projects[1]!.projectKey,
    );
    expect(moved?.shown).toEqual(["Grouped", "A", "C"]);
    expect(moved?.order).toContain(hiddenKey);
    expect(
      applyMove(projects, [], projects[1]!.projectKey, projects[2]!.projectKey)?.shown,
    ).toEqual(["A", "C", "Grouped"]);
  });

  it("ignores a drop on itself or on an unknown tile", () => {
    const projects = [homeProject("A"), homeProject("B")];
    expect(planHomeReorder(projects, [], projects[0]!.projectKey, projects[0]!.projectKey)).toBe(
      null,
    );
    expect(planHomeReorder(projects, [], projects[0]!.projectKey, "missing")).toBe(null);
  });
});

describe("searchHomeProjects", () => {
  const projects = [
    homeProject("Studio", { workspaceRoots: ["/work/omniflix-studio"] }),
    homeProject("Omniflix"),
    homeProject("Poker"),
  ];

  it("ranks a name match above a path match and drops non-matches", () => {
    expect(names(searchHomeProjects(projects, "omni"))).toEqual(["Omniflix", "Studio"]);
  });

  it("returns every project, in order, for a blank query", () => {
    expect(searchHomeProjects(projects, "   ")).toBe(projects);
  });
});

describe("homeTileTint", () => {
  it("uses the configured icon colour and is stable for a name", () => {
    expect(
      homeTileTint({ title: "Any", projectIcon: { kind: "monogram", text: "A", color: "red" } }),
    ).toEqual({ hue: 25, chroma: 0.15 });
    expect(
      homeTileTint({
        title: "Any",
        projectIcon: { kind: "lucide", name: "box", color: "gray" },
      }).chroma,
    ).toBeLessThan(0.05);
    expect(homeTileTint({ title: "Omniflix", projectIcon: null })).toEqual(
      homeTileTint({ title: "Omniflix", projectIcon: { kind: "emoji", emoji: "🎬" } }),
    );
  });

  it("spreads unconfigured projects across hues", () => {
    const hues = new Set(
      ["Omniflix", "FlatPlat", "PanamaSAAS", "Poker", "Hermes", "Sing", "Fitness"].map(
        (title) => homeTileTint({ title, projectIcon: null }).hue,
      ),
    );
    expect(hues.size).toBeGreaterThan(3);
  });
});

describe("homeDockProjects", () => {
  it("keeps pinned projects in grid order", () => {
    const projects = [
      homeProject("A", { pinned: true }),
      homeProject("B"),
      homeProject("C", { pinned: true }),
    ];
    expect(names(homeDockProjects(projects))).toEqual(["A", "C"]);
  });
});

const runtime = (status: "running" | "preparing" | "idle") => ({
  status,
  activeRunId: null,
  providerInstanceId: ProviderInstanceId.make("codex"),
  providerName: "Codex",
  lastError: null,
  updatedAt: "2026-03-09T10:00:00.000Z",
});

const completedRun = {
  runId: RunId.make("run-1"),
  status: "completed" as const,
  assistantMessageId: null,
  requestedAt: "2026-03-09T10:00:00.000Z",
  startedAt: "2026-03-09T10:00:00.000Z",
  completedAt: "2026-03-09T10:05:00.000Z",
};

function thread(
  id: string,
  project: ReturnType<typeof homeProject>,
  overrides: ThreadFixtureOverrides = {},
) {
  return makeThreadFixture({
    id: ThreadId.make(id),
    environmentId,
    projectId: project.memberProjectRefs[0]!.projectId,
    runtime: null,
    latestRun: null,
    ...overrides,
  });
}

describe("summarizeHomeBadges", () => {
  const omniflix = homeProject("Omniflix");
  const poker = homeProject("Poker");

  const summarize = (
    threads: Parameters<typeof summarizeHomeBadges>[0]["threads"],
    extra: {
      readonly localLastVisitedAtById?: Readonly<Record<string, string>>;
      readonly appRunningThreadKeys?: ReadonlySet<string>;
      readonly draftThreads?: ReadonlyArray<{
        readonly environmentId: EnvironmentId;
        readonly threadId: string;
        readonly projectId: string;
      }>;
    } = {},
  ) =>
    summarizeHomeBadges({
      projects: [omniflix, poker],
      threads,
      delegatedUnderParent: new Set(),
      localLastVisitedAtById: extra.localLastVisitedAtById ?? {},
      appRunningThreadKeys: extra.appRunningThreadKeys ?? new Set(),
      draftThreads: extra.draftThreads ?? [],
    });

  it("counts threads that need the user and unseen completions", () => {
    const badges = summarize([
      thread("approval", omniflix, { hasPendingApprovals: true }),
      thread("input", omniflix, { hasPendingUserInput: true }),
      thread("guest", omniflix, { pendingGuestMessageCount: 2 }),
      thread("unseen", omniflix, {
        latestRun: completedRun,
        lastVisitedAt: "2026-03-09T10:01:00.000Z",
      }),
      thread("seen", omniflix, {
        latestRun: completedRun,
        lastVisitedAt: "2026-03-09T10:06:00.000Z",
      }),
      thread("waiting-unseen", omniflix, {
        latestRun: completedRun,
        lastVisitedAt: "2026-03-09T10:01:00.000Z",
        runtime: runtime("idle"),
      }),
      thread("archived", omniflix, {
        hasPendingApprovals: true,
        archivedAt: "2026-03-09T10:00:00.000Z",
      }),
    ]);
    expect(badges.get(omniflix.projectKey)).toEqual({
      attention: 4,
      working: false,
      appRunning: false,
    });
    expect(badges.get(poker.projectKey)).toBeUndefined();
  });

  it("reads the local visit when the server sent none", () => {
    const { lastVisitedAt: _serverVisit, ...unseen } = thread("unseen", omniflix, {
      latestRun: completedRun,
    });
    const visitedAt = (at: string) => ({ [`${environmentId}:unseen`]: at });
    expect(
      summarize([unseen], { localLastVisitedAtById: visitedAt("2026-03-09T10:01:00.000Z") }).get(
        omniflix.projectKey,
      )?.attention,
    ).toBe(1);
    expect(
      summarize([unseen], { localLastVisitedAtById: visitedAt("2026-03-09T10:06:00.000Z") }).get(
        omniflix.projectKey,
      ),
    ).toBeUndefined();
  });

  it("marks working projects and skips hidden subagent threads", () => {
    const parent = thread("parent", omniflix);
    const subagent = thread("subagent", poker, {
      hasPendingApprovals: true,
      runtime: runtime("running"),
      lineage: {
        rootThreadId: parent.id,
        parentThreadId: parent.id,
        relationshipToParent: "subagent",
      },
    });
    const badges = summarize([
      parent,
      subagent,
      thread("preparing", omniflix, { runtime: runtime("preparing") }),
    ]);
    expect(badges.get(omniflix.projectKey)).toEqual({
      attention: 0,
      working: true,
      appRunning: false,
    });
    expect(badges.get(poker.projectKey)).toBeUndefined();
  });

  it("maps running apps to projects through threads and unsent drafts", () => {
    const badges = summarize([thread("run", omniflix)], {
      appRunningThreadKeys: new Set([`${environmentId}:run`, `${environmentId}:draft-thread`]),
      draftThreads: [
        {
          environmentId,
          threadId: "draft-thread",
          projectId: poker.memberProjectRefs[0]!.projectId,
        },
      ],
    });
    expect(badges.get(omniflix.projectKey)?.appRunning).toBe(true);
    expect(badges.get(poker.projectKey)).toEqual({ ...NO_HOME_BADGES, appRunning: true });
  });
});

describe("resolveAppRunningThreadKeys", () => {
  const run = (overrides: Partial<ProjectRun> = {}): ProjectRun => ({
    id: 1,
    scriptId: "dev",
    command: "pnpm dev",
    longRunning: true,
    terminalId: "terminal-1",
    sawTerminal: true,
    sawRunning: true,
    startGraceElapsed: true,
    previewOpened: false,
    ...overrides,
  });
  const session = (threadId: string, hasRunningSubprocess: boolean) => ({
    target: { threadId: ThreadId.make(threadId), terminalId: "terminal-1" },
    state: { status: "running" as const, hasRunningSubprocess },
  });

  it("follows terminal metadata, and the last sighting without it", () => {
    const remote = EnvironmentId.make("environment-remote");
    const running = resolveAppRunningThreadKeys(
      {
        [`${environmentId}:live`]: { dev: run() },
        [`${environmentId}:stopped`]: { dev: run() },
        [`${environmentId}:closed`]: { dev: run() },
        [`${remote}:unknown`]: { dev: run() },
        [`${remote}:never-seen`]: { dev: run({ sawRunning: false, sawTerminal: false }) },
      },
      new Map([
        [environmentId, [session("live", true), session("stopped", false)]],
        [remote, null],
      ]),
    );
    expect([...running].toSorted()).toEqual([
      `${environmentId}:live`,
      `${remote}:never-seen`,
      `${remote}:unknown`,
    ]);
  });
});

describe("latestHomeThread", () => {
  it("opens the newest listed thread of any member", () => {
    const grouped = homeProject("Grouped", { workspaceRoots: ["/work/a", "/work/b"] });
    const older = makeThreadFixture({
      id: ThreadId.make("older"),
      environmentId,
      projectId: grouped.memberProjectRefs[0]!.projectId,
      latestUserMessageAt: "2026-03-09T10:00:00.000Z",
    });
    const newer = makeThreadFixture({
      id: ThreadId.make("newer"),
      environmentId,
      projectId: grouped.memberProjectRefs[1]!.projectId,
      latestUserMessageAt: "2026-03-10T10:00:00.000Z",
    });
    const archived = makeThreadFixture({
      id: ThreadId.make("archived"),
      environmentId,
      projectId: grouped.memberProjectRefs[0]!.projectId,
      latestUserMessageAt: "2026-03-11T10:00:00.000Z",
      archivedAt: "2026-03-11T10:00:00.000Z",
    });
    expect(latestHomeThread(grouped, [older, newer, archived], new Set(), "updated_at")?.id).toBe(
      "newer",
    );
    expect(latestHomeThread(homeProject("Empty"), [older], new Set(), "updated_at")).toBe(null);
  });
});

describe("badge text", () => {
  it("caps the count and names every badge", () => {
    expect(formatHomeBadgeCount(3)).toBe("3");
    expect(formatHomeBadgeCount(12)).toBe("9+");
    expect(
      homeProjectAccessibleName("Omniflix", { attention: 2, working: true, appRunning: true }),
    ).toBe("Omniflix, 2 need attention, working, app running");
    expect(homeProjectAccessibleName("Poker", NO_HOME_BADGES)).toBe("Poker");
  });
});
