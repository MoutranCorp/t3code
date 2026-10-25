import {
  ProviderSetupError,
  type ClaudeSettings,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Queue from "effect/Queue";
import * as Option from "effect/Option";
import * as ChildProcess from "effect/process/ChildProcess";
import { ChildProcessSpawner } from "effect/process";
import * as PtyAdapter from "@t3tools/shared/PtyAdapter";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as ProviderAuthFlow from "@t3tools/provider-core/server/providerAuthFlow";
import { makeClaudeEnvironment, resolveClaudeHomePath } from "./Drivers/ClaudeHome.ts";

export const makeClaudeAccountAuth = Effect.fn("makeClaudeAccountAuth")(function* (options: {
  readonly instanceId: ProviderInstanceId;
  readonly config: ClaudeSettings;
  readonly environment: NodeJS.ProcessEnv;
  readonly cwd: string;
  readonly verify: Effect.Effect<boolean>;
  readonly onChanged: Effect.Effect<void>;
}) {
  const pty = yield* Effect.serviceOption(PtyAdapter.PtyAdapter);
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const environment = yield* makeClaudeEnvironment(options.config, options.environment);
  const home = yield* resolveClaudeHomePath(options.config, environment);
  const failure = (operation: string, detail: string) =>
    new ProviderSetupError({ instanceId: options.instanceId, operation, detail });
  const loginCommand = yield* resolveSpawnCommand(options.config.binaryPath, ["auth", "login"], {
    env: environment,
  });
  const logoutCommand = yield* resolveSpawnCommand(options.config.binaryPath, ["auth", "logout"], {
    env: environment,
  });
  return yield* ProviderAuthFlow.make({
    instanceId: options.instanceId,
    credentialBinding: { owner: "provider", key: `claude:${home}` },
    methods: Effect.succeed(
      Option.isSome(pty)
        ? [
            {
              id: "login",
              name: "Sign in to Claude",
              type: "terminal" as const,
              description: "Choose the Claude account you want to add in your browser.",
            },
          ]
        : [],
    ),
    authenticate: Effect.fn("ClaudeAccountAuth.authenticate")(function* (_, context) {
      if (Option.isNone(pty))
        return yield* failure("start", "Sign-in terminals are unavailable on this environment.");
      const exited = yield* Deferred.make<number>();
      const output = yield* Queue.sliding<string>(64);
      const terminal = yield* pty.value
        .spawn({
          shell: loginCommand.command,
          args: [...loginCommand.args],
          cwd: options.cwd,
          env: environment,
          cols: 80,
          rows: 24,
        })
        .pipe(
          Effect.mapError(() =>
            failure(
              "start",
              "Could not start Claude sign-in. Check that Claude Code is installed.",
            ),
          ),
        );
      const detachData = terminal.onData((data) => {
        Queue.offerUnsafe(output, data.slice(-16_384));
      });
      const detachExit = terminal.onExit(({ exitCode }) => {
        Deferred.doneUnsafe(exited, Effect.succeed(exitCode));
      });
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          detachData();
          detachExit();
          try {
            terminal.kill();
          } catch {}
        }),
      );
      let transcript = "";
      let outputOffset = 0;
      const update = () =>
        context.setInteraction(
          { type: "terminal", id: "terminal", output: transcript, outputOffset },
          (response) =>
            response.type === "terminal"
              ? Effect.try({
                  try: () => {
                    if (response.size) terminal.resize(response.size.cols, response.size.rows);
                    if (response.data) terminal.write(response.data);
                  },
                  catch: () =>
                    failure("respond", "The sign-in terminal closed. Start sign-in again."),
                })
              : Effect.void,
        );
      yield* update();
      yield* Queue.take(output).pipe(
        Effect.flatMap((data) => {
          outputOffset += data.length;
          transcript = (transcript + data).slice(-16_384);
          return update();
        }),
        Effect.forever,
        Effect.forkScoped,
      );
      if ((yield* Deferred.await(exited)) !== 0)
        return yield* failure("start", "Claude sign-in did not complete. Try again.");
      yield* context.verifying;
      if (!(yield* options.verify))
        return yield* failure("verify", "Claude did not confirm the login. Try signing in again.");
    }),
    logout: Effect.gen(function* () {
      const child = yield* spawner.spawn(
        ChildProcess.make(logoutCommand.command, logoutCommand.args, {
          cwd: options.cwd,
          env: environment,
        }),
      );
      if ((yield* child.exitCode) !== 0)
        return yield* failure("logout", "Claude could not sign out. Try again.");
      yield* options.onChanged;
    }).pipe(
      Effect.scoped,
      Effect.mapError(() => failure("logout", "Claude could not sign out. Try again.")),
    ),
  });
});
