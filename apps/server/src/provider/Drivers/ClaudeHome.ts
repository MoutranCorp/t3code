import type { ClaudeSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import * as HostProcess from "@t3tools/shared/HostProcess";

const quotePath = Schema.encodeSync(Schema.fromJsonString(Schema.String));

export const resolveClaudeAccountSettings = Effect.fn("resolveClaudeAccountSettings")(function* (
  config: ClaudeSettings,
  stateDir: string,
  instanceId: string,
) {
  if (!config.managedAccount) return config;
  const path = yield* Path.Path;
  return {
    ...config,
    homePath: path.join(stateDir, "providers", "claude", "accounts", instanceId),
    sessionHomePath: path.join(stateDir, "providers", "claude", "shared"),
  };
});

export const resolveClaudeHomePath = Effect.fn("resolveClaudeHomePath")(function* (
  config: Pick<ClaudeSettings, "homePath">,
  environment?: NodeJS.ProcessEnv,
): Effect.fn.Return<string, never, Path.Path> {
  const path = yield* Path.Path;
  const home = yield* HostProcess.HomeDirectory;
  const homePath = config.homePath.trim();
  if (homePath.length > 0) {
    return path.resolve(expandHomePath(homePath, home));
  }
  // Inherited env vars are not shell-expanded, so a literal `~` stays literal.
  const inherited = environment?.CLAUDE_CONFIG_DIR?.trim() ?? "";
  if (inherited.length > 0) {
    return path.resolve(inherited);
  }
  return path.resolve(path.join(home, ".claude"));
});

export const makeClaudeEnvironment = Effect.fn("makeClaudeEnvironment")(function* (
  config: Pick<ClaudeSettings, "homePath" | "managedAccount">,
  baseEnv?: NodeJS.ProcessEnv,
): Effect.fn.Return<NodeJS.ProcessEnv, never, Path.Path> {
  const resolvedBaseEnv = baseEnv ?? process.env;
  const homePath = config.homePath.trim();
  if (homePath.length === 0) return resolvedBaseEnv;
  const resolvedHomePath = yield* resolveClaudeHomePath(config);
  return {
    ...resolvedBaseEnv,
    ...(config.managedAccount
      ? {
          ANTHROPIC_API_KEY: undefined,
          ANTHROPIC_AUTH_TOKEN: undefined,
          CLAUDE_CODE_OAUTH_TOKEN: undefined,
        }
      : {}),
    // Changing HOME hides macOS Keychain credentials; use CLAUDE_CONFIG_DIR to keep login access.
    CLAUDE_CONFIG_DIR: resolvedHomePath,
  };
});

/** managed-mcp.json excludes other MCP config and forbids --strict-mcp-config; omit the flag when present. */
export const hasClaudeManagedMcpConfig = Effect.fn("hasClaudeManagedMcpConfig")(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const platform = yield* HostProcess.Platform;
  const managedMcpConfigPath =
    platform === "darwin"
      ? "/Library/Application Support/ClaudeCode/managed-mcp.json"
      : platform === "win32"
        ? "C:\\Program Files\\ClaudeCode\\managed-mcp.json"
        : "/etc/claude-code/managed-mcp.json";
  return yield* fileSystem.exists(managedMcpConfigPath).pipe(Effect.orElseSucceed(() => false));
});

export const makeClaudeContinuationGroupKey = Effect.fn("makeClaudeContinuationGroupKey")(
  function* (
    config: Pick<ClaudeSettings, "homePath" | "sessionHomePath">,
    environment?: NodeJS.ProcessEnv,
  ): Effect.fn.Return<string, never, Path.Path> {
    const resolvedHomePath = yield* resolveClaudeHomePath(
      { homePath: config.sessionHomePath?.trim() || config.homePath },
      environment,
    );
    return `claude:home:${resolvedHomePath}`;
  },
);

export class ClaudeSessionHomeError extends Schema.TaggedError<ClaudeSessionHomeError>()(
  "ClaudeSessionHomeError",
  { detail: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {
  override get message(): string {
    return this.detail;
  }
}
const isClaudeSessionHomeError = Schema.is(ClaudeSessionHomeError);

export const prepareClaudeSessionHome = Effect.fn("prepareClaudeSessionHome")(function* (
  config: Pick<ClaudeSettings, "homePath" | "sessionHomePath">,
  environment?: NodeJS.ProcessEnv,
) {
  if (!config.sessionHomePath?.trim()) return;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const accountHome = yield* resolveClaudeHomePath(config, environment);
  const sessionHome = yield* resolveClaudeHomePath({ homePath: config.sessionHomePath });
  if (accountHome === sessionHome) return;
  const target = path.join(sessionHome, "projects");
  const link = path.join(accountHome, "projects");
  yield* Effect.gen(function* () {
    yield* fs.makeDirectory(target, { recursive: true });
    yield* fs.makeDirectory(accountHome, { recursive: true });
    const existing = yield* fs.readLink(link).pipe(Effect.catch(() => Effect.succeed(null)));
    if (existing !== null && path.resolve(path.dirname(link), existing) === target) return;
    if (existing !== null || (yield* fs.exists(link))) {
      return yield* new ClaudeSessionHomeError({
        detail: `Claude history directory '${link}' already exists. Use a fresh account directory to share conversations.`,
      });
    }
    yield* fs.symlink(target, link);
  }).pipe(
    Effect.mapError((cause) =>
      isClaudeSessionHomeError(cause)
        ? cause
        : new ClaudeSessionHomeError({
            detail: "Could not prepare shared Claude conversations.",
            cause,
          }),
    ),
  );
});

export const makeClaudeCapabilitiesCacheKey = Effect.fn("makeClaudeCapabilitiesCacheKey")(
  function* (
    config: Pick<ClaudeSettings, "binaryPath" | "homePath">,
    cwd?: string,
    environment?: NodeJS.ProcessEnv,
  ): Effect.fn.Return<string, never, Path.Path> {
    const resolvedHomePath = yield* resolveClaudeHomePath(config, environment);
    return `${config.binaryPath}\0${resolvedHomePath}\0${cwd ?? ""}`;
  },
);

/** Separate spawn env from login commands to preserve literal paths, including relative inherited values. */
export const claudeSignedOutMessage = (input: {
  readonly configDir: string | undefined;
  readonly cwd: string;
}): string => {
  const configuration =
    input.configDir !== undefined
      ? ` from ${quotePath(input.cwd)}, with CLAUDE_CONFIG_DIR set to ${quotePath(input.configDir)}`
      : "";
  return `Claude could not authenticate. For subscription login, run \`claude auth login\` on this environment's machine${configuration}, then start a new thread. For API-key authentication, check this instance's configured credentials.`;
};
