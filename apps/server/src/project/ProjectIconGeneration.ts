import {
  CommandId,
  type Project,
  ProjectId,
  type ServerSettingsError,
  type TextGenerationError,
} from "@t3tools/contracts";
import { sanitizeProjectIconSvg } from "@t3tools/shared/projectIconSvg";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as ProjectService from "./ProjectService.ts";

export class ProjectIconUnusableError extends Schema.TaggedError<ProjectIconUnusableError>()(
  "ProjectIconUnusableError",
  { projectId: ProjectId },
) {
  override get message(): string {
    return "The model did not return a drawing Facio can show. Try again.";
  }
}

const README_NAMES = ["README.md", "readme.md", "README", "README.txt"];
const README_CONTEXT_LENGTH = 1_500;

export class ProjectIconGeneration extends Context.Service<
  ProjectIconGeneration,
  {
    /** Asks the text generation model to draw the project's icon, then stores it as an override. */
    readonly generate: (input: {
      readonly projectId: ProjectId;
    }) => Effect.Effect<
      Project,
      | ProjectService.ProjectServiceError
      | ProjectIconUnusableError
      | ServerSettingsError
      | TextGenerationError
    >;
  }
>()("t3/project/ProjectIconGeneration") {}

const make = Effect.gen(function* () {
  const projects = yield* ProjectService.ProjectService;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const textGeneration = yield* TextGeneration.TextGeneration;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const random = yield* SecureRandom.SecureRandom;

  const readOptional = (file: string) => fileSystem.readFileString(file).pipe(Effect.option);

  // Context is a nicety: an unreadable or missing file leaves it out.
  const projectContext = Effect.fn("ProjectIconGeneration.projectContext")(function* (
    workspaceRoot: string,
  ) {
    const sections: string[] = [];
    const manifest = yield* readOptional(path.join(workspaceRoot, "package.json"));
    if (Option.isSome(manifest)) {
      const description = (() => {
        try {
          const parsed: unknown = JSON.parse(manifest.value);
          return typeof parsed === "object" &&
            parsed !== null &&
            "description" in parsed &&
            typeof parsed.description === "string"
            ? parsed.description.trim()
            : "";
        } catch {
          return "";
        }
      })();
      if (description) sections.push(`package.json description: ${description}`);
    }
    for (const name of README_NAMES) {
      const readme = yield* readOptional(path.join(workspaceRoot, name));
      if (Option.isSome(readme)) {
        sections.push(readme.value.slice(0, README_CONTEXT_LENGTH));
        break;
      }
    }
    return sections.join("\n\n");
  });

  const generate: ProjectIconGeneration["Service"]["generate"] = Effect.fn(
    "ProjectIconGeneration.generate",
  )(function* (input) {
    const found = yield* projects.getById(input.projectId);
    if (Option.isNone(found)) {
      return yield* new ProjectService.ProjectNotFoundError({ projectId: input.projectId });
    }
    const project = found.value;
    const settings = resolveProjectSettings(yield* serverSettings.getSettings, project.id).settings;
    const drawn = yield* textGeneration.generateProjectIcon({
      cwd: project.workspaceRoot,
      projectTitle: project.title,
      context: yield* projectContext(project.workspaceRoot),
      modelSelection: settings.textGenerationModelSelection,
      projectId: project.id,
    });
    const svg = sanitizeProjectIconSvg(drawn.svg);
    if (svg === null) return yield* new ProjectIconUnusableError({ projectId: project.id });
    return yield* projects.update({
      commandId: CommandId.make(`project-icon:${yield* random.uuidV4()}`),
      projectId: project.id,
      projectIcon: { kind: "svg", svg },
    });
  });

  return ProjectIconGeneration.of({ generate });
});

export const layer = Layer.effect(ProjectIconGeneration, make);
