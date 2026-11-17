import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ProviderInstanceId, type ProviderAuthState } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as PtyAdapter from "@t3tools/shared/PtyAdapter";
import { makeTerminalLoginAuth } from "./terminalLoginAuth.ts";

const makeHarness = Effect.fn("TerminalLoginAuth.testHarness")(function* (
  verified = true,
  platform: NodeJS.Platform = "linux",
  binaryPath = "grok",
) {
  let spawned: PtyAdapter.PtySpawnInput | undefined;
  let exit: ((event: PtyAdapter.PtyExitEvent) => void) | undefined;
  let killed = false;
  const controller = yield* makeTerminalLoginAuth({
    instanceId: ProviderInstanceId.make("grok_personal"),
    label: "Grok",
    binaryPath,
    loginArgs: ["login"],
    logoutArgs: ["logout"],
    description: "Sign in.",
    credentialKey: "grok:default",
    environment: { PATH: "/tools", GROK_HOME: "/isolated-grok" },
    cwd: "/workspace",
    verify: Effect.succeed(verified),
    onChanged: Effect.void,
  }).pipe(
    Effect.provideService(HostProcess.Platform, platform),
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
  const ready = yield* state((value) => (value.methods?.length ?? 0) > 0);
  return {
    controller,
    state,
    ready,
    spawned: () => spawned,
    killed: () => killed,
    exit: (exitCode: number) => exit?.({ exitCode, signal: null }),
  };
});

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))("terminal login sign-in", (it) => {
  it.effect("advertises a labelled terminal method and verifies a successful login", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness();
      expect(h.ready.methods?.[0]).toMatchObject({ name: "Sign in to Grok", type: "terminal" });
      yield* h.controller.start("owner");
      yield* h.state((value) => value.interaction?.type === "terminal");
      expect(h.spawned()?.env.GROK_HOME).toBe("/isolated-grok");
      expect(h.spawned()?.args?.at(-1)).toBe("login");
      h.exit(0);
      yield* h.state((value) => value.phase === "succeeded");
      expect(h.killed()).toBe(true);
    }),
  );
  it.effect("launches Windows command shims through cmd.exe", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness(true, "win32", String.raw`C:\tools\grok.cmd`);
      yield* h.controller.start("owner");
      yield* h.state((value) => value.interaction?.type === "terminal");
      expect(h.spawned()?.shell).toBe("cmd.exe");
      expect(h.spawned()?.args).toEqual(["/d", "/c", String.raw`C:\tools\grok.cmd`, "login"]);
    }),
  );
  it.effect("fails when the login command exits with an error", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness();
      yield* h.controller.start("owner");
      yield* h.state((value) => value.interaction?.type === "terminal");
      h.exit(1);
      const state = yield* h.state((value) => value.phase === "failed");
      expect(state.message).toContain("Grok sign-in did not complete");
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
});
