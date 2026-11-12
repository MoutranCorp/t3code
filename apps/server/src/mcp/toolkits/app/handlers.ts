import * as Effect from "effect/Effect";

import * as TerminalManager from "../../../terminal/Manager.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { AppToolkit } from "./tools.ts";

export const layer = McpToolAccess.toLayer(AppToolkit, {
  t3_app_status: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const thread = yield* McpInvocationContext.requireThreadScope(scope, "t3_app_status");
      const terminals = yield* TerminalManager.TerminalManager;
      return {
        terminals: yield* terminals.readThreadApps({
          threadId: thread.thread.threadId,
          outputLines: input.lines ?? 40,
        }),
      };
    }),
  ),
});
