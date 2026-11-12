import { assert, it } from "@effect/vitest";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { type Project, ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as ProjectIconGeneration from "./ProjectIconGeneration.ts";
import * as ProjectService from "./ProjectService.ts";

const projectId = ProjectId.make("project-icon");

const run = (drawn: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const workspaceRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-project-icon-" });
    yield* fileSystem.writeFileString(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({ description: "Tide charts for sailors" }),
    );
    yield* fileSystem.writeFileString(path.join(workspaceRoot, "README.md"), "# Tides");
    const project = {
      id: projectId,
      title: "Tides",
      workspaceRoot,
      defaultModelSelection: null,
      scripts: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      deletedAt: null,
    } satisfies Project;
    const prompts: Array<{ projectTitle: string; context: string }> = [];
    const updates: Array<ProjectService.ProjectUpdateInput> = [];
    const result = yield* ProjectIconGeneration.ProjectIconGeneration.pipe(
      Effect.flatMap((service) => service.generate({ projectId })),
      Effect.result,
      Effect.provide(
        ProjectIconGeneration.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(ProjectService.ProjectService)({
                getById: () => Effect.succeedSome(project),
                update: (input) =>
                  Effect.sync(() => {
                    updates.push(input);
                    return { ...project, projectIcon: input.projectIcon ?? null };
                  }),
              }),
              Layer.mock(TextGeneration.TextGeneration)({
                generateProjectIcon: (input) =>
                  Effect.sync(() => {
                    prompts.push({ projectTitle: input.projectTitle, context: input.context });
                    return { svg: drawn };
                  }),
              }),
              ServerSettings.layerTest(),
            ),
          ),
        ),
      ),
    );
    return { result, prompts, updates };
  }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)));

it.effect("stores the sanitized drawing, drawn from the project's description", () =>
  Effect.gen(function* () {
    const { result, prompts, updates } = yield* run(
      '```svg\n<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="12" fill="#fff" onclick="x()"/></svg>\n```',
    );
    assert.isTrue(result._tag === "Success");
    assert.deepEqual(prompts, [
      {
        projectTitle: "Tides",
        context: "package.json description: Tide charts for sailors\n\n# Tides",
      },
    ]);
    assert.deepEqual(
      updates.map((update) => update.projectIcon),
      [
        {
          kind: "svg",
          svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="12" fill="#fff"/></svg>',
        },
      ],
    );
  }),
);

it.effect("stores nothing when the model's reply is not a usable drawing", () =>
  Effect.gen(function* () {
    const { result, updates } = yield* run("I cannot draw that.");
    assert.isTrue(result._tag === "Failure" && result.failure._tag === "ProjectIconUnusableError");
    assert.deepEqual(updates, []);
  }),
);
