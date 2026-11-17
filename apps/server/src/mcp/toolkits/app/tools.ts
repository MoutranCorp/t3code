import { OrchestratorMcpFailure, TerminalAppStatus } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";

import * as TerminalManager from "../../../terminal/Manager.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const AppStatusTool = Tool.make("t3_app_status", {
  description:
    "Check this thread's terminals, where the user's Run button starts the app: what each runs, the local URLs it listens on, and its last output lines. Use it to see whether the app is running, where, and why it stopped.",
  parameters: Schema.Struct({
    lines: Schema.optional(
      Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 })).annotate({
        description: "Output lines per terminal. Default 40.",
      }),
    ),
  }),
  success: Schema.Struct({ terminals: Schema.Array(TerminalAppStatus) }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [McpInvocationContext.McpInvocationContext, TerminalManager.TerminalManager],
})
  .annotate(Tool.Title, "Check running app")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

export const AppToolkit = Toolkit.make(AppStatusTool);
