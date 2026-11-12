import { EnvironmentId, ProjectId, RunId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deriveProjectActivity, findRunningAppThread } from "./projectScreen.logic";

const environmentId = EnvironmentId.make("environment-local");
const projectA = { environmentId, projectId: ProjectId.make("project-a") };
const projectB = { environmentId, projectId: ProjectId.make("project-b") };

function run(
  status: "completed" | "failed" | "interrupted" | "running",
  times: { readonly startedAt?: string; readonly completedAt?: string },
) {
  return {
    runId: RunId.make(`run-${status}`),
    status,
    requestedAt: null,
    startedAt: times.startedAt ?? null,
    completedAt: times.completedAt ?? null,
    assistantMessageId: null,
  };
}

function activityThread(
  id: string,
  createdAt: string,
  latestRun: ReturnType<typeof run> | null = null,
) {
  return { environmentId, id: ThreadId.make(id), title: id, createdAt, latestRun };
}

describe("deriveProjectActivity", () => {
  it("lists thread starts and latest run outcomes newest first, capped", () => {
    const activity = deriveProjectActivity(
      [
        activityThread(
          "done",
          "2026-01-01T10:00:00.000Z",
          run("completed", { completedAt: "2026-01-01T12:00:00.000Z" }),
        ),
        activityThread(
          "broke",
          "2026-01-01T09:00:00.000Z",
          run("failed", { completedAt: "2026-01-01T11:00:00.000Z" }),
        ),
        activityThread(
          "busy",
          "2026-01-01T08:00:00.000Z",
          run("running", { startedAt: "2026-01-01T13:00:00.000Z" }),
        ),
        activityThread(
          "halted",
          "2026-01-01T07:00:00.000Z",
          run("interrupted", { completedAt: "2026-01-01T07:30:00.000Z" }),
        ),
      ],
      5,
    );
    expect(activity.map((entry) => [entry.title, entry.kind])).toEqual([
      ["busy", "working"],
      ["done", "completed"],
      ["broke", "failed"],
      ["done", "created"],
      ["broke", "created"],
    ]);
  });

  it("skips runs without a usable time", () => {
    const activity = deriveProjectActivity(
      [activityThread("pending", "2026-01-01T10:00:00.000Z", run("completed", {}))],
      10,
    );
    expect(activity.map((entry) => entry.kind)).toEqual(["created"]);
  });
});

describe("findRunningAppThread", () => {
  const threads = [
    { environmentId, id: ThreadId.make("other-project"), projectId: projectB.projectId },
    { environmentId, id: ThreadId.make("newest"), projectId: projectA.projectId },
    { environmentId, id: ThreadId.make("older"), projectId: projectA.projectId },
  ];

  it("picks the newest running thread of the project's members", () => {
    expect(
      findRunningAppThread({
        refs: [projectA],
        threads,
        drafts: {},
        appRunningThreadKeys: new Set([
          `${environmentId}:other-project`,
          `${environmentId}:older`,
          `${environmentId}:newest`,
        ]),
      }),
    ).toEqual({ environmentId, threadId: "newest", draftId: null });
  });

  it("falls back to a draft that runs the app", () => {
    expect(
      findRunningAppThread({
        refs: [projectA],
        threads,
        drafts: {
          "draft-1": {
            environmentId,
            threadId: ThreadId.make("draft-thread"),
            projectId: projectA.projectId,
          },
        },
        appRunningThreadKeys: new Set([`${environmentId}:draft-thread`]),
      }),
    ).toEqual({ environmentId, threadId: "draft-thread", draftId: "draft-1" });
  });

  it("is null when only another project runs", () => {
    expect(
      findRunningAppThread({
        refs: [projectA],
        threads,
        drafts: {},
        appRunningThreadKeys: new Set([`${environmentId}:other-project`]),
      }),
    ).toBeNull();
  });
});
