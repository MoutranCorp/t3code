import * as NodeOS from "node:os";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ClaudeSettings } from "@t3tools/contracts";

import {
  makeClaudeCapabilitiesCacheKey,
  makeClaudeContinuationGroupKey,
  makeClaudeEnvironment,
  prepareClaudeSessionHome,
  resolveClaudeHomePath,
  resolveClaudeAccountSettings,
} from "./ClaudeHome.ts";
const decodeSettings = Schema.decodeSync(ClaudeSettings);

it.layer(NodeServices.layer)("ClaudeHome", (it) => {
  describe("Claude home resolution", () => {
    it.effect(
      "allocates independent account homes under server state with one shared history",
      () =>
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const state = path.resolve("/server-state");
          const config = decodeSettings({ managedAccount: true });
          const first = yield* resolveClaudeAccountSettings(config, state, "claude_one");
          const second = yield* resolveClaudeAccountSettings(config, state, "claude_two");
          expect(first.homePath).toBe(
            path.join(state, "providers", "claude", "accounts", "claude_one"),
          );
          expect(first.homePath).not.toBe(second.homePath);
          expect(first.sessionHomePath).toBe(second.sessionHomePath);
          expect(yield* makeClaudeContinuationGroupKey(first)).toBe(
            yield* makeClaudeContinuationGroupKey(second),
          );
        }),
    );
    it.effect("uses the managed account login instead of inherited credential overrides", () =>
      Effect.gen(function* () {
        const environment = yield* makeClaudeEnvironment(
          { homePath: "/managed-account", managedAccount: true },
          {
            ANTHROPIC_API_KEY: "other-account",
            CLAUDE_CODE_OAUTH_TOKEN: "other-login",
            PATH: "/tools",
          },
        );
        expect(environment.ANTHROPIC_API_KEY).toBeUndefined();
        expect(environment.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
        expect(environment.PATH).toBe("/tools");
      }),
    );
    it.effect("shares continuation identity while keeping account capability caches separate", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const sessionHomePath = path.resolve("/claude-shared");
        const first = { homePath: path.resolve("/claude-one"), sessionHomePath };
        const second = { homePath: path.resolve("/claude-two"), sessionHomePath };
        expect(yield* makeClaudeContinuationGroupKey(first)).toBe(
          yield* makeClaudeContinuationGroupKey(second),
        );
        expect(yield* makeClaudeCapabilitiesCacheKey({ ...first, binaryPath: "claude" })).not.toBe(
          yield* makeClaudeCapabilitiesCacheKey({ ...second, binaryPath: "claude" }),
        );
      }),
    );

    it.effect("shares transcripts without linking credentials or account settings", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-claude-accounts-" });
        const sessionHomePath = path.join(root, "shared");
        const homePath = path.join(root, "account");
        yield* fs.makeDirectory(homePath);
        yield* fs.writeFileString(path.join(homePath, ".credentials.json"), "private");
        yield* prepareClaudeSessionHome({ homePath, sessionHomePath });
        yield* prepareClaudeSessionHome({ homePath, sessionHomePath });
        yield* fs.writeFileString(path.join(sessionHomePath, "projects", "chat.jsonl"), "history");
        expect(yield* fs.readFileString(path.join(homePath, "projects", "chat.jsonl"))).toBe(
          "history",
        );
        expect(yield* fs.readFileString(path.join(homePath, ".credentials.json"))).toBe("private");
        expect(yield* fs.exists(path.join(sessionHomePath, ".credentials.json"))).toBe(false);
      }).pipe(Effect.scoped),
    );

    it.effect("refuses to replace an existing account's transcripts", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-claude-conflict-" });
        const homePath = path.join(root, "account");
        yield* fs.makeDirectory(path.join(homePath, "projects"), { recursive: true });
        yield* fs.writeFileString(path.join(homePath, "projects", "chat.jsonl"), "keep");
        const result = yield* prepareClaudeSessionHome({
          homePath,
          sessionHomePath: path.join(root, "shared"),
        }).pipe(Effect.result);
        expect(result._tag).toBe("Failure");
        expect(yield* fs.readFileString(path.join(homePath, "projects", "chat.jsonl"))).toBe(
          "keep",
        );
      }).pipe(Effect.scoped),
    );

    it.effect("resolves configured Claude HOME and stamps continuation/cache keys with it", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const homePath = "~/.claude-work";
        const resolved = path.resolve(NodeOS.homedir(), ".claude-work");

        expect(yield* resolveClaudeHomePath({ homePath })).toBe(resolved);
        expect((yield* makeClaudeEnvironment({ homePath })).CLAUDE_CONFIG_DIR).toBe(resolved);
        expect(yield* makeClaudeContinuationGroupKey({ homePath })).toBe(`claude:home:${resolved}`);
        expect(yield* makeClaudeCapabilitiesCacheKey({ binaryPath: "claude", homePath })).toBe(
          `claude\0${resolved}\0`,
        );
      }),
    );

    it.effect("uses inherited CLAUDE_CONFIG_DIR when homePath is empty", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const inherited = path.resolve("/tmp/claude-inherited");
        const environment = { CLAUDE_CONFIG_DIR: inherited };

        expect(yield* resolveClaudeHomePath({ homePath: "" }, environment)).toBe(inherited);
        expect(yield* makeClaudeContinuationGroupKey({ homePath: "" }, environment)).toBe(
          `claude:home:${inherited}`,
        );

        const explicit = path.resolve(NodeOS.homedir(), ".claude-work");
        expect(yield* resolveClaudeHomePath({ homePath: "~/.claude-work" }, environment)).toBe(
          explicit,
        );
      }),
    );

    it.effect("separates capability probes by cwd", () =>
      Effect.gen(function* () {
        const config = { binaryPath: "claude", homePath: "" };
        const first = yield* makeClaudeCapabilitiesCacheKey(config, "/repo-a");
        const second = yield* makeClaudeCapabilitiesCacheKey(config, "/repo-b");
        expect(first).not.toBe(second);
      }),
    );
  });
});
