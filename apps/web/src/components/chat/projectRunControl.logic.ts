import type {
  AdvertisedEndpoint,
  DiscoveredLocalServer,
  PreviewSessionSnapshot,
  ProjectScript,
  ThreadId,
} from "@t3tools/contracts";
import type { TerminalSessionState } from "@t3tools/client-runtime/state/terminal";
import { isTailnetHost } from "@t3tools/shared/hostClassification";
import { isLoopbackHost } from "@t3tools/shared/preview";
import type { DetectedRunTarget } from "@t3tools/shared/projectRunDetection";

import type { ThreadPreviewState } from "~/previewStateStore";
import { buildProjectScript, nextProjectScriptId, primaryProjectScript } from "~/projectScripts";

/**
 * A command that dies before the subprocess poll sees it never shows as running. Windows reports
 * the first subprocess several seconds late, and a long Starting beats a false Exited.
 */
export const RUN_START_GRACE_MS = 20_000;

/** A run started from the Run control, remembered per thread and script. */
export interface ProjectRun {
  readonly id: number;
  readonly scriptId: string;
  readonly command: string;
  /** Only "play" targets can fail by ending; we cannot see exit codes, so other runs just finish. */
  readonly longRunning: boolean;
  /** Null until the terminal has opened and the command was typed. */
  readonly terminalId: string | null;
  readonly sawTerminal: boolean;
  readonly sawRunning: boolean;
  readonly startGraceElapsed: boolean;
  readonly previewOpened: boolean;
}

export interface RunTerminalState {
  readonly status: TerminalSessionState["status"];
  readonly hasRunningSubprocess: boolean;
}

/** Null when terminal metadata is not known (loading or no read access). */
export type RunTerminals = ReadonlyMap<string, RunTerminalState> | null;

export type ProjectRunPhase = "idle" | "starting" | "running" | "exited";

export interface ProjectRunView {
  readonly phase: ProjectRunPhase;
  /** The script Run starts: last invoked, else the primary one. */
  readonly script: ProjectScript | null;
  /** The default script's run while it is starting, running or exited. */
  readonly run: ProjectRun | null;
}

/** `undefined` means unknown, `null` means the terminal is not listed. */
function terminalFor(
  terminals: RunTerminals,
  terminalId: string | null,
): RunTerminalState | null | undefined {
  if (terminals === null || terminalId === null) return undefined;
  return terminals.get(terminalId) ?? null;
}

/** Folds what the terminal shows now into the run. Returns the same run when nothing changed. */
export function observeProjectRun(run: ProjectRun, terminals: RunTerminals): ProjectRun {
  const terminal = terminalFor(terminals, run.terminalId);
  if (!terminal) return run;
  const sawRunning = run.sawRunning || terminal.hasRunningSubprocess;
  if (run.sawTerminal && sawRunning === run.sawRunning) return run;
  return { ...run, sawTerminal: true, sawRunning };
}

export function deriveProjectRunPhase(
  run: ProjectRun | undefined,
  terminals: RunTerminals,
): ProjectRunPhase {
  if (!run) return "idle";
  const observed = observeProjectRun(run, terminals);
  const terminal = terminalFor(terminals, observed.terminalId);
  if (terminal === undefined) return observed.sawRunning ? "running" : "starting";
  // A terminal that disappears after it was seen was closed on purpose, from here or the drawer.
  if (terminal === null) return observed.sawTerminal ? "idle" : "starting";
  const ended = observed.longRunning ? "exited" : "idle";
  if (terminal.status === "exited" || terminal.status === "error") return ended;
  if (terminal.hasRunningSubprocess) return "running";
  return observed.sawRunning || observed.startGraceElapsed ? ended : "starting";
}

function defaultRunScript(
  scripts: ReadonlyArray<ProjectScript>,
  preferredScriptId: string | null,
): ProjectScript | null {
  return (
    scripts.find((script) => script.id === preferredScriptId) ??
    primaryProjectScript(scripts) ??
    scripts[0] ??
    null
  );
}

export function deriveProjectRunView(input: {
  readonly scripts: ReadonlyArray<ProjectScript>;
  readonly preferredScriptId: string | null;
  readonly runs: Readonly<Record<string, ProjectRun>>;
  readonly terminals: RunTerminals;
}): ProjectRunView {
  const script = defaultRunScript(input.scripts, input.preferredScriptId);
  // Freshly detected scripts start before the saved settings arrive back.
  const runKey = script?.id ?? input.preferredScriptId;
  const run = runKey === null ? undefined : input.runs[runKey];
  const phase = deriveProjectRunPhase(run, input.terminals);
  return { phase, script, run: phase === "idle" || !run ? null : run };
}

export function findRunServer(
  servers: ReadonlyArray<DiscoveredLocalServer>,
  threadId: ThreadId,
  run: ProjectRun,
): DiscoveredLocalServer | null {
  if (run.terminalId === null) return null;
  return (
    servers.find(
      (server) =>
        server.terminal?.threadId === threadId && server.terminal.terminalId === run.terminalId,
    ) ?? null
  );
}

function urlOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** An open preview tab already on one of the urls' origins, the active tab first, so a rerun reuses it. */
export function findPreviewTabForUrls(
  preview: Pick<ThreadPreviewState, "sessions" | "suppressedTabIds" | "activeTabId">,
  urls: ReadonlyArray<string>,
): PreviewSessionSnapshot | null {
  const origins = new Set(urls.map(urlOrigin).filter((origin) => origin !== null));
  const matches = Object.values(preview.sessions).filter((session) => {
    if (preview.suppressedTabIds.has(session.tabId) || session.navStatus._tag === "Idle") {
      return false;
    }
    const origin = urlOrigin(session.navStatus.url);
    return origin !== null && origins.has(origin);
  });
  return matches.find((session) => session.tabId === preview.activeTabId) ?? matches[0] ?? null;
}

/** Scripts with their own preview URL already open it when they run. */
export function runAwaitsPreview(
  run: ProjectRun,
  phase: ProjectRunPhase,
  script: ProjectScript | undefined,
): boolean {
  return (
    (phase === "starting" || phase === "running") &&
    run.terminalId !== null &&
    !run.previewOpened &&
    !(script?.previewUrl && script.autoOpenPreview)
  );
}

export function buildDetectedProjectScripts(
  targets: ReadonlyArray<DetectedRunTarget>,
  existingIds: ReadonlyArray<string>,
): { readonly scripts: ReadonlyArray<ProjectScript>; readonly runScript: ProjectScript | null } {
  const ids = [...existingIds];
  const scripts = targets.map((target) => {
    const id = nextProjectScriptId(target.name, ids);
    ids.push(id);
    return buildProjectScript(id, {
      name: target.name,
      command: target.command,
      icon: target.icon,
      runOnWorktreeCreate: false,
      waitForSetup: false,
      runOnSettle: false,
      previewUrl: null,
      autoOpenPreview: false,
    });
  });
  return { scripts, runScript: scripts.find((script) => script.icon === "play") ?? null };
}

/** The detector reads these; for every other detection path it only checks existence. */
export const RUN_DETECTION_CONTENT_FILES: ReadonlySet<string> = new Set([
  "t3.json",
  "package.json",
  "pyproject.toml",
  "Makefile",
]);

/** Directories to list, parents first, so existence checks need no file reads. */
export function runDetectionDirectories(paths: ReadonlyArray<string>): ReadonlyArray<string> {
  const directories = new Set([""]);
  for (const path of paths) {
    const slash = path.lastIndexOf("/");
    if (slash > 0) directories.add(path.slice(0, slash));
  }
  return [...directories].toSorted(
    (left, right) => left.split("/").length - right.split("/").length || left.localeCompare(right),
  );
}

/** Existing files map to their contents when the detector reads them, else to "". */
export function buildRunDetectionFiles(
  paths: ReadonlyArray<string>,
  existingFiles: ReadonlySet<string>,
  contents: Readonly<Record<string, string | null>>,
): Record<string, string> {
  const files: Record<string, string> = {};
  for (const path of paths) {
    if (!existingFiles.has(path)) continue;
    files[path] = RUN_DETECTION_CONTENT_FILES.has(path) ? (contents[path] ?? "") : "";
  }
  return files;
}

// CSI, OSC (BEL or ST terminated) and two-byte escapes.
const TERMINAL_ESCAPE_PATTERN =
  /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-_])/g;

export interface TerminalOutputTail {
  readonly text: string;
  readonly lineStart: number;
  readonly lineEnd: number;
}

/** Plain text of the last `maxLines` lines of raw PTY output, with 1-based line numbers. */
export function terminalOutputTail(raw: string, maxLines: number): TerminalOutputTail | null {
  const lines = raw
    .replace(TERMINAL_ESCAPE_PATTERN, "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    // A bare carriage return redraws the line, so only the last redraw is visible.
    .map((line) => line.slice(line.lastIndexOf("\r") + 1).trimEnd());
  while (lines.length > 0 && lines.at(-1) === "") lines.pop();
  if (lines.length === 0) return null;
  const lineStart = Math.max(1, lines.length - maxLines + 1);
  return {
    text: lines.slice(lineStart - 1).join("\n"),
    lineStart,
    lineEnd: lines.length,
  };
}

export interface RunPhoneAddress {
  readonly label: string;
  readonly url: string;
}

type PhoneEndpoint = Pick<AdvertisedEndpoint, "label" | "httpBaseUrl" | "reachability" | "status">;

/**
 * Where a phone can open a run's server: the address this client already reaches it at when that is
 * on the network, else this computer's LAN and tailnet addresses with the server's port.
 */
export function runPhoneAddresses(
  serverUrl: string,
  endpoints: ReadonlyArray<PhoneEndpoint>,
): ReadonlyArray<RunPhoneAddress> {
  const server = parseUrl(serverUrl);
  if (!server) return [];
  if (!isLoopbackHost(server.hostname)) {
    return [{ label: isTailnetHost(server.hostname) ? "Tailscale" : "Network", url: server.href }];
  }
  const addresses = new Map<string, RunPhoneAddress>();
  for (const endpoint of endpoints) {
    if (endpoint.reachability !== "lan" && endpoint.reachability !== "private-network") continue;
    const base = parseUrl(endpoint.httpBaseUrl);
    // HTTPS endpoints are proxies for Facio's own port, not the app's.
    if (!base || base.protocol !== "http:" || endpoint.status === "unavailable") continue;
    const url = new URL(server.href);
    url.hostname = base.hostname;
    if (!addresses.has(url.href)) addresses.set(url.href, { label: endpoint.label, url: url.href });
  }
  return [...addresses.values()];
}

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

export function noRunTargetPrompt(): string {
  return [
    "Work out how to run this project locally: install its dependencies if needed, then start it (usually a dev server).",
    'When it runs, write a `t3.json` at the project root with a `scripts` array whose entries have `name`, `command` and `icon` (use `"play"` for the main run command) so the Facio Run button can pick it up.',
  ].join("\n\n");
}

export function runExitedPrompt(command: string): string {
  return `The \`${command}\` run for this project stopped unexpectedly. Find out why and fix it.`;
}
