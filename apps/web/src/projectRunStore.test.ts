import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { requestProjectRun, takeProjectRunRequest } from "./projectRunStore";

describe("project run requests", () => {
  it("is taken once, and only by the requested project", () => {
    const environmentId = EnvironmentId.make("environment-local");
    const project = { environmentId, id: ProjectId.make("project-a") };
    requestProjectRun({ environmentId, projectId: project.id });

    expect(takeProjectRunRequest({ environmentId, id: ProjectId.make("project-b") })).toBe(false);
    expect(
      takeProjectRunRequest({
        environmentId: EnvironmentId.make("environment-remote"),
        id: project.id,
      }),
    ).toBe(false);
    expect(takeProjectRunRequest(project)).toBe(true);
    expect(takeProjectRunRequest(project)).toBe(false);
  });
});
