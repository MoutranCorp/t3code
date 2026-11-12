import { useAtomValue } from "@effect/atom-react";
import type { KnownTerminalSession } from "@t3tools/client-runtime/state/terminal";
import type { EnvironmentId, ProjectId, ProjectScript, ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { useEffect, useState } from "react";

import type { AppBarAction } from "../../components/ui/AppBar.types";
import * as Dialog from "../../components/ui/Dialog";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import {
  deriveProjectRunPhase,
  findRunServer,
  primaryRunScript,
  resolveReachableAppUrl,
  RUN_START_GRACE_MS,
} from "../../lib/projectRun";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { previewEnvironment } from "../../state/preview";
import { forgetProjectRun, projectRunsAtom, recordProjectRun } from "../../state/project-runs";
import { useEnvironmentQuery } from "../../state/query";
import { usePreparedConnection } from "../../state/session";

/** The thread bar's Run button: runs the project's primary script and opens its server. */
export function useThreadProjectRun(input: {
  readonly environmentId: EnvironmentId | null;
  readonly threadId: ThreadId | null;
  readonly projectId: ProjectId | null;
  readonly scripts: ReadonlyArray<ProjectScript>;
  readonly terminalSessions: ReadonlyArray<KnownTerminalSession> | null;
  readonly canOperateTerminal: boolean;
  readonly runScript: (script: ProjectScript) => Promise<string | undefined>;
  readonly openTerminal: (terminalId: string) => void;
}): ReadonlyArray<AppBarAction> {
  const { environmentId, threadId, projectId } = input;
  const threadKey =
    environmentId === null || threadId === null ? null : scopedThreadKey(environmentId, threadId);
  const run = useAtomValue(projectRunsAtom, (runs) =>
    threadKey === null ? undefined : runs[threadKey],
  );
  const [now, setNow] = useState(Date.now);
  const terminals =
    input.terminalSessions?.map((session) => ({
      terminalId: session.target.terminalId,
      status: session.state.status,
      hasRunningSubprocess: session.state.hasRunningSubprocess,
    })) ?? null;
  const phase = deriveProjectRunPhase(run, terminals, now);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- re-reads the clock when the start grace ends, and drops a run whose terminal has ended
  useEffect(() => {
    if (run === undefined || threadKey === null) return;
    if (phase === "idle") {
      forgetProjectRun(threadKey, run);
      return;
    }
    if (phase !== "starting") return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(0, run.startedAt + RUN_START_GRACE_MS - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [phase, run, threadKey]);

  // Discovery probes ports on the server, so it only runs while a run is live.
  const discovery = useEnvironmentQuery(
    environmentId !== null && run !== undefined && phase !== "idle"
      ? previewEnvironment.discoveredServers({ environmentId, input: {} })
      : null,
  );
  const prepared = usePreparedConnection(environmentId);
  const server =
    run !== undefined && threadId !== null
      ? findRunServer(discovery.data?.servers ?? [], threadId, run)
      : null;
  const appUrl =
    server !== null && Option.isSome(prepared)
      ? resolveReachableAppUrl(server.url, prepared.value.httpBaseUrl)
      : null;

  const script = primaryRunScript(input.scripts);
  if (environmentId === null || threadId === null || projectId === null || threadKey === null) {
    return [];
  }

  if (run !== undefined && phase !== "idle") {
    const showTerminal = () => input.openTerminal(run.terminalId);
    const status: AppBarAction =
      phase === "running"
        ? {
            accessibilityLabel: `App running: ${run.command}. Show terminal`,
            icon: "play",
            selected: true,
            subtitle: "Running",
            onPress: showTerminal,
          }
        : {
            accessibilityLabel: `Starting ${run.command}. Show terminal`,
            icon: "play",
            loading: true,
            subtitle: "Starting",
            onPress: showTerminal,
          };
    if (server === null) return [status];
    return [
      status,
      appUrl === null
        ? {
            accessibilityLabel: `Port ${server.port} is not reachable from this device`,
            icon: "safari",
            disabled: true,
            subtitle: `Port ${server.port} is only reachable on the environment's machine`,
            onPress: () => {},
          }
        : {
            accessibilityLabel: "Open app in browser",
            icon: "safari",
            subtitle: appUrl,
            onPress: () => {
              void tryOpenExternalUrl(appUrl, "app-preview").then((opened) => {
                if (!opened) Dialog.alert("Could not open the app", appUrl);
              });
            },
          },
    ];
  }

  if (script === null || !input.canOperateTerminal) return [];
  return [
    {
      accessibilityLabel: `Run ${script.name}`,
      icon: "play",
      subtitle: script.command,
      onPress: () => {
        const startedAt = Date.now();
        void input.runScript(script).then((terminalId) => {
          if (terminalId === undefined) return;
          setNow(startedAt);
          recordProjectRun(threadKey, {
            environmentId,
            threadId,
            projectId,
            scriptId: script.id,
            command: script.command,
            terminalId,
            startedAt,
          });
        });
      },
    },
  ];
}
