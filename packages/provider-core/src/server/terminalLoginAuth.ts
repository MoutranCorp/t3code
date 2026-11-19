import { ProviderSetupError, type ProviderInstanceId } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as ChildProcess from "effect/process/ChildProcess";
import { ChildProcessSpawner } from "effect/process";
import * as PtyAdapter from "@t3tools/shared/PtyAdapter";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as ProviderAuthFlow from "./providerAuthFlow.ts";

const TRANSCRIPT_LIMIT = 16_384;

/**
 * In-app sign-in for CLIs whose login is an interactive command (`<cli> login`).
 * The command runs in a server-side PTY that the client renders as a terminal.
 */
export const makeTerminalLoginAuth = Effect.fn("makeTerminalLoginAuth")(function* (options: {
  readonly instanceId: ProviderInstanceId;
  /** Shown to the user, e.g. "Grok". */
  readonly label: string;
  readonly binaryPath: string;
  readonly loginArgs: ReadonlyArray<string>;
  readonly logoutArgs: ReadonlyArray<string>;
  readonly description: string;
  readonly credentialKey: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly cwd: string;
  readonly verify: Effect.Effect<boolean>;
  readonly onChanged: Effect.Effect<void>;
}) {
  const pty = yield* Effect.serviceOption(PtyAdapter.PtyAdapter);
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const { environment, label } = options;
  const failure = (operation: string, detail: string) =>
    new ProviderSetupError({ instanceId: options.instanceId, operation, detail });
  const loginCommand = yield* resolveSpawnCommand(options.binaryPath, options.loginArgs, {
    env: environment,
  });
  // node-pty cannot apply ResolvedSpawnCommand.shell, so batch shims need explicit cmd.exe dispatch.
  const loginPty = loginCommand.shell
    ? {
        shell: environment.ComSpec ?? environment.COMSPEC ?? "cmd.exe",
        args: ["/d", "/c", options.binaryPath, ...options.loginArgs],
      }
    : { shell: loginCommand.command, args: [...loginCommand.args] };
  const logoutCommand = yield* resolveSpawnCommand(options.binaryPath, options.logoutArgs, {
    env: environment,
  });
  return yield* ProviderAuthFlow.make({
    instanceId: options.instanceId,
    credentialBinding: { owner: "provider", key: options.credentialKey },
    methods: Effect.succeed(
      Option.isSome(pty)
        ? [
            {
              id: "login",
              name: `Sign in to ${label}`,
              type: "terminal" as const,
              description: options.description,
            },
          ]
        : [],
    ),
    authenticate: Effect.fn("TerminalLoginAuth.authenticate")(function* (_, context) {
      if (Option.isNone(pty))
        return yield* failure("start", "Sign-in terminals are unavailable on this environment.");
      const exited = yield* Deferred.make<number>();
      const output = yield* Queue.sliding<string>(64);
      const terminal = yield* pty.value
        .spawn({
          shell: loginPty.shell,
          args: loginPty.args,
          cwd: options.cwd,
          env: environment,
          cols: 80,
          rows: 24,
        })
        .pipe(
          Effect.mapError(() =>
            failure("start", `Could not start ${label} sign-in. Check that ${label} is installed.`),
          ),
        );
      const detachData = terminal.onData((data) => {
        Queue.offerUnsafe(output, data.slice(-TRANSCRIPT_LIMIT));
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
          transcript = (transcript + data).slice(-TRANSCRIPT_LIMIT);
          return update();
        }),
        Effect.forever,
        Effect.forkScoped,
      );
      if ((yield* Deferred.await(exited)) !== 0)
        return yield* failure("start", `${label} sign-in did not complete. Try again.`);
      yield* context.verifying;
      if (!(yield* options.verify))
        return yield* failure(
          "verify",
          `${label} did not confirm the login. Try signing in again.`,
        );
    }),
    logout: Effect.gen(function* () {
      const child = yield* spawner.spawn(
        ChildProcess.make(logoutCommand.command, logoutCommand.args, {
          cwd: options.cwd,
          env: environment,
        }),
      );
      if ((yield* child.exitCode) !== 0)
        return yield* failure("logout", `${label} could not sign out. Try again.`);
      yield* options.onChanged;
    }).pipe(
      Effect.scoped,
      Effect.mapError(() => failure("logout", `${label} could not sign out. Try again.`)),
    ),
  });
});
