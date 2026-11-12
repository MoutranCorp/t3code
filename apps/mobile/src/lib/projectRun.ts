import type { TerminalSessionState } from "@t3tools/client-runtime/state/terminal";
import type { DiscoveredLocalServer, ProjectScript } from "@t3tools/contracts";
import { isLocalLoopbackHost, isPrivateNetworkHost } from "@t3tools/shared/hostClassification";
import { isLoopbackHost } from "@t3tools/shared/preview";

/**
 * A command that dies before the subprocess poll sees it never shows as running, and Windows
 * reports the first subprocess several seconds late; until then a run reads as starting.
 */
export const RUN_START_GRACE_MS = 20_000;

/** A run started from this device's Run button. */
export interface ProjectRun {
  readonly scriptId: string;
  readonly command: string;
  readonly terminalId: string;
  readonly startedAt: number;
}

export interface RunTerminal {
  readonly terminalId: string;
  readonly status: TerminalSessionState["status"];
  readonly hasRunningSubprocess: boolean;
}

export type ProjectRunPhase = "idle" | "starting" | "running";

// Mirrors web's primaryProjectScript, which lives in apps/web.
export function primaryRunScript(scripts: ReadonlyArray<ProjectScript>): ProjectScript | null {
  return (
    scripts.find((script) => !script.runOnWorktreeCreate && !script.runOnSettle) ??
    scripts.find((script) => !script.runOnSettle) ??
    null
  );
}

/** `terminals` is null while terminal metadata is unknown (loading, or no read access). */
export function deriveProjectRunPhase(
  run: ProjectRun | undefined,
  terminals: ReadonlyArray<RunTerminal> | null,
  now: number,
): ProjectRunPhase {
  if (run === undefined) return "idle";
  const withinGrace = now - run.startedAt < RUN_START_GRACE_MS;
  if (terminals === null) return withinGrace ? "starting" : "idle";
  const terminal = terminals.find((candidate) => candidate.terminalId === run.terminalId);
  if (terminal?.hasRunningSubprocess) return "running";
  if (terminal && terminal.status !== "starting" && terminal.status !== "running") return "idle";
  return withinGrace ? "starting" : "idle";
}

export function findRunServer(
  servers: ReadonlyArray<DiscoveredLocalServer>,
  threadId: string,
  run: ProjectRun,
): DiscoveredLocalServer | null {
  return (
    servers.find(
      (server) =>
        server.terminal?.threadId === threadId && server.terminal.terminalId === run.terminalId,
    ) ?? null
  );
}

const HTTP_URL = /^(https?):\/\/(\[[^\]]*\]|[^/?#:]*)(?::(\d+))?([/?#].*)?$/i;

/**
 * Where this phone reaches a server the environment discovered, or null when only the
 * environment's own loopback reaches it (a relay or tunnel connection, for example).
 */
export function resolveReachableAppUrl(rawUrl: string, environmentBaseUrl: string): string | null {
  const server = HTTP_URL.exec(rawUrl.trim());
  const environment = HTTP_URL.exec(environmentBaseUrl.trim());
  if (!server || !environment) return null;
  const [, protocol, host, port, rest] = server;
  if (!isLoopbackHost(host!.toLowerCase())) return rawUrl;
  const environmentHost = environment[2]!;
  if (!isPrivateNetworkHost(environmentHost)) return null;
  const reachableHost = isLocalLoopbackHost(environmentHost) ? "localhost" : environmentHost;
  return `${protocol!.toLowerCase()}://${reachableHost}${port ? `:${port}` : ""}${rest ?? "/"}`;
}
