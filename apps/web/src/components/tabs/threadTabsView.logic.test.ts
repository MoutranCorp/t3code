import { EnvironmentId, ProjectId, ProviderInstanceId, RunId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadFixture, type ThreadFixtureOverrides } from "../../test-fixtures";
import {
  buildRailProjects,
  deriveShownThreadTabs,
  describeThreadMarkCounts,
  resolveThreadMark,
  strongestThreadMark,
  summarizeThreadMarks,
} from "./threadTabsView.logic";

const environmentId = EnvironmentId.make("env");

function project(name: string, pinned = false) {
  return {
    projectKey: `key:${name}`,
    pinned,
    memberProjectRefs: [{ environmentId, projectId: ProjectId.make(`project:${name}`) }],
  };
}

const runtime = (status: "running" | "preparing" | "idle" | "failed") => ({
  status,
  activeRunId: null,
  providerInstanceId: ProviderInstanceId.make("codex"),
  providerName: "Codex",
  lastError: null,
  updatedAt: "2026-03-09T10:00:00.000Z",
});

const run = (status: "completed" | "failed") => ({
  runId: RunId.make("run-1"),
  status,
  assistantMessageId: null,
  requestedAt: "2026-03-09T10:00:00.000Z",
  startedAt: "2026-03-09T10:00:00.000Z",
  completedAt: "2026-03-09T10:05:00.000Z",
});

const BEFORE_RUN = "2026-03-09T10:01:00.000Z";
const AFTER_RUN = "2026-03-09T10:06:00.000Z";

function thread(
  id: string,
  owner: ReturnType<typeof project>,
  overrides: ThreadFixtureOverrides = {},
) {
  return makeThreadFixture({
    id: ThreadId.make(id),
    environmentId,
    projectId: owner.memberProjectRefs[0]!.projectId,
    runtime: null,
    latestRun: null,
    ...overrides,
  });
}

describe("resolveThreadMark", () => {
  const owner = project("a");
  it.each([
    ["needs-you", { hasPendingApprovals: true }],
    ["needs-you", { hasPendingUserInput: true }],
    ["working", { runtime: runtime("running") }],
    ["error", { runtime: runtime("failed"), latestRun: run("failed"), lastVisitedAt: BEFORE_RUN }],
    [null, { runtime: runtime("failed"), latestRun: run("failed"), lastVisitedAt: AFTER_RUN }],
    ["done", { latestRun: run("completed"), lastVisitedAt: BEFORE_RUN }],
    [null, { latestRun: run("completed"), lastVisitedAt: AFTER_RUN }],
    // A waiting thread stays quiet even with an unseen completion.
    [null, { latestRun: run("completed"), lastVisitedAt: BEFORE_RUN, runtime: runtime("idle") }],
  ] as const)("reads %s", (expected, overrides) => {
    expect(resolveThreadMark(thread("t", owner, overrides))).toBe(expected);
  });
});

describe("summarizeThreadMarks", () => {
  it("counts marks per project, lists what waits on the user, and reads local visits", () => {
    const alpha = project("alpha");
    const beta = project("beta");
    const approval = thread("approval", alpha, { hasPendingApprovals: true });
    const working = thread("working", alpha, { runtime: runtime("running") });
    const { lastVisitedAt: _server, ...unseenLocally } = thread("done", beta, {
      latestRun: run("completed"),
    });
    const archived = thread("archived", beta, {
      hasPendingApprovals: true,
      archivedAt: "2026-03-09T10:00:00.000Z",
    });
    const summary = summarizeThreadMarks({
      projects: [alpha, beta],
      threads: [approval, working, unseenLocally, archived],
      delegatedUnderParent: new Set(),
      localLastVisitedAtById: { [`${environmentId}:done`]: BEFORE_RUN },
    });
    expect(summary.countsByProjectKey.get(alpha.projectKey)).toEqual({
      "needs-you": 1,
      error: 0,
      working: 1,
      done: 0,
    });
    expect(summary.countsByProjectKey.get(beta.projectKey)).toEqual({
      "needs-you": 0,
      error: 0,
      working: 0,
      done: 1,
    });
    expect(summary.waiting.map((entry) => [entry.thread.id, entry.mark])).toEqual([
      ["approval", "needs-you"],
      ["done", "done"],
    ]);
  });

  it("ranks needs-you over failures, work and completions", () => {
    const counts = { "needs-you": 0, error: 0, working: 2, done: 3 };
    expect(strongestThreadMark(counts)).toBe("working");
    expect(strongestThreadMark({ ...counts, "needs-you": 1 })).toBe("needs-you");
    expect(strongestThreadMark({ "needs-you": 0, error: 0, working: 0, done: 0 })).toBeNull();
    expect(describeThreadMarkCounts(counts)).toBe("2 working · 3 done");
  });
});

describe("deriveShownThreadTabs", () => {
  it("hides archived and missing threads and sent drafts, and finds each tab's project", () => {
    const alpha = project("alpha");
    const live = thread("live", alpha, { title: "Live" });
    const archived = thread("archived", alpha, { archivedAt: "2026-03-09T10:00:00.000Z" });
    const shown = deriveShownThreadTabs({
      tabs: [
        { key: "env:live", target: { kind: "thread", environmentId, threadId: "live" } },
        { key: "env:archived", target: { kind: "thread", environmentId, threadId: "archived" } },
        { key: "env:gone", target: { kind: "thread", environmentId, threadId: "gone" } },
        { key: "draft:d1", target: { kind: "draft", draftId: "d1", threadId: "x" } },
        { key: "draft:sent", target: { kind: "draft", draftId: "sent", threadId: "y" } },
      ],
      threadByKey: new Map([
        ["env:live", live],
        ["env:archived", archived],
      ]),
      drafts: { d1: alpha.memberProjectRefs[0] },
      projects: [alpha],
    });
    expect(shown.map((tab) => [tab.key, tab.title, tab.project?.projectKey])).toEqual([
      ["env:live", "Live", alpha.projectKey],
      ["draft:d1", "New thread", alpha.projectKey],
    ]);
  });
});

describe("buildRailProjects", () => {
  it("lists pinned projects, then tab projects in tab order, then busy ones, once each", () => {
    const [a, b, c, d] = [project("a", true), project("b"), project("c"), project("d")];
    const rail = buildRailProjects({
      pinned: [a!],
      projects: [a!, b!, c!, d!],
      tabProjectKeys: [c!.projectKey, a!.projectKey, c!.projectKey],
      busyProjectKeys: new Set([b!.projectKey, c!.projectKey]),
    });
    expect(rail.pinned.map((entry) => entry.projectKey)).toEqual([a!.projectKey]);
    expect(rail.open.map((entry) => entry.projectKey)).toEqual([c!.projectKey, b!.projectKey]);
  });
});
