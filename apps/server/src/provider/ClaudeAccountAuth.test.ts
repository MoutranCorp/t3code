import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ClaudeSettings, ProviderInstanceId, type ProviderAuthState } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as PtyAdapter from "@t3tools/shared/PtyAdapter";
import { makeClaudeAccountAuth } from "./ClaudeAccountAuth.ts";
const decodeSettings = Schema.decodeSync(ClaudeSettings);

const makeHarness = Effect.fn("ClaudeAccountAuth.testHarness")(function* (verified = true) {
  let spawned: PtyAdapter.PtySpawnInput | undefined;
  let exit: ((event: PtyAdapter.PtyExitEvent) => void) | undefined;
  let killed = false;
  const controller = yield* makeClaudeAccountAuth({
    instanceId: ProviderInstanceId.make("claude_personal"),
    config: decodeSettings({ binaryPath: "claude", homePath: "/isolated-claude" }),
    environment: { PATH: "/tools" },
    cwd: "/workspace",
    verify: Effect.succeed(verified),
    onChanged: Effect.void,
  }).pipe(
    Effect.provideService(PtyAdapter.PtyAdapter, {
      spawn: (input) =>
        Effect.sync(() => {
          spawned = input;
          return {
            pid: 1,
            write: () => {},
            resize: () => {},
            kill: () => {
              killed = true;
            },
            onData: () => () => {},
            onExit: (callback) => {
              exit = callback;
              return () => {
                exit = undefined;
              };
            },
          };
        }),
    }),
  );
  const state = (predicate: (state: ProviderAuthState) => boolean) =>
    controller
      .subscribe("owner")
      .pipe(Stream.filter(predicate), Stream.runHead, Effect.map(Option.getOrThrow));
  yield* state((value) => (value.methods?.length ?? 0) > 0);
  return {
    controller,
    state,
    spawned: () => spawned,
    killed: () => killed,
    exit: (exitCode: number) => exit?.({ exitCode, signal: null }),
  };
});

it.layer(NodeServices.layer)("Claude account sign-in", (it) => {
  it.effect("uses isolated credentials and verifies a successful login", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness();
      yield* h.controller.start("owner");
      yield* h.state((value) => value.interaction?.type === "terminal");
      expect(h.spawned()?.env.CLAUDE_CONFIG_DIR).toContain("isolated-claude");
      expect(h.spawned()?.args?.join(" ")).toContain("auth login");
      h.exit(0);
      yield* h.state((value) => value.phase === "succeeded");
      expect(h.killed()).toBe(true);
    }),
  );
  it.effect("does not report success when the account cannot be verified", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness(false);
      yield* h.controller.start("owner");
      yield* h.state((value) => value.interaction?.type === "terminal");
      h.exit(0);
      const state = yield* h.state((value) => value.phase === "failed");
      expect(state.message).toContain("did not confirm");
    }),
  );
  it.effect("cancels only the owned sign-in terminal", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness();
      const flow = yield* h.controller.start("owner");
      yield* h.state((value) => value.interaction?.type === "terminal");
      yield* h.controller.cancel("owner", flow.flowId!);
      expect(h.killed()).toBe(true);
      yield* h.state((value) => value.phase === "cancelled");
    }),
  );
});
