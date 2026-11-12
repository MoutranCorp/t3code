import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  deriveLogicalProjectKeyFromSettings,
  selectProjectGroupingSettings,
} from "@t3tools/client-runtime/state/project-grouping";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  mapAtomCommandResult,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  terminalOutputText,
  type TerminalBufferState,
} from "@t3tools/client-runtime/state/terminal";
import {
  AuthPreviewOperateScope,
  AuthTerminalOperateScope,
  AuthTerminalReadScope,
  type DiscoveredLocalServer,
  type ProjectScript,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { detectRunTargets } from "@t3tools/shared/projectRunDetection";
import { projectScriptMenuLabel } from "@t3tools/shared/projectScripts";
import { getTerminalLabel } from "@t3tools/shared/terminalLabels";
import { useNavigate } from "@tanstack/react-router";
import { AsyncResult, Atom } from "effect/reactivity";
import {
  ChevronDownIcon,
  PlayIcon,
  RotateCwIcon,
  SettingsIcon,
  SquareIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import {
  memo,
  useEffect,
  useEffectEvent,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

import { resolveDiscoveredServerUrl } from "~/browser/browserTargetResolver";
import { usePreviewAvailable } from "~/browser/previewRuntime";
import { previewRuntimeTabId } from "~/browser/previewRuntimeTabId";
import { useComposerDraftStore } from "~/composerDraftStore";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { getClientSettings } from "~/hooks/useSettings";
import { randomUUID } from "~/lib/utils";
import { useThreadDiscoveredPorts } from "~/portDiscoveryState";
import { readThreadPreviewState, setActivePreviewTab } from "~/previewStateStore";
import {
  attachProjectRunTerminal,
  beginProjectRun,
  claimProjectRunPreview,
  forgetProjectRun,
  replaceProjectRun,
  selectProjectRunRequested,
  selectThreadRuns,
  takeProjectRunRequest,
  useProjectRunStore,
} from "~/projectRunStore";
import { previewEnvironment } from "~/state/preview";
import { useEnvironmentScope } from "~/state/session";
import { terminalEnvironment } from "~/state/terminal";
import { useKnownTerminalSessions } from "~/state/terminalSessions";
import { useRightPanelStore } from "~/rightPanelStore";
import { useAtomCommand } from "~/state/use-atom-command";
import { useTerminalUiStateStore } from "~/terminalUiStateStore";
import { openDiscoveredPort } from "../preview/openDiscoveredPort";
import { previewBridge } from "../preview/previewBridge";
import { ScriptIcon } from "../projectScriptEditor";
import { useThreadTerminalActions } from "../terminal/useThreadTerminalActions";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Group, GroupSeparator } from "../ui/group";
import { Menu, MenuItem, MenuItemLabel, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  buildDetectedProjectScripts,
  deriveProjectRunPhase,
  deriveProjectRunView,
  findPreviewTabForUrls,
  findRunServer,
  noRunTargetPrompt,
  observeProjectRun,
  type ProjectRun,
  runAwaitsPreview,
  runExitedPrompt,
  terminalOutputTail,
} from "./projectRunControl.logic";
import { readRunDetectionFiles } from "./readRunDetectionFiles";

const FIX_OUTPUT_LINES = 60;
const LABEL_CLASS = "sr-only @xl/chat-header:not-sr-only";
const NO_TERMINAL_OUTPUT_ATOM = Atom.make(AsyncResult.initial<TerminalBufferState, never>(false));

interface RunScriptOptions {
  readonly preferNewTerminal?: boolean;
  readonly setupCommand?: string;
}

interface ProjectRunControlProps {
  readonly threadRef: ScopedThreadRef;
  readonly project: EnvironmentProject;
  /** Where scripts run: the thread's worktree, else the project root. */
  readonly cwd: string;
  readonly scripts: ReadonlyArray<ProjectScript>;
  readonly preferredScriptId: string | null;
  readonly onRunScript: (
    script: ProjectScript,
    options?: RunScriptOptions,
  ) => Promise<string | undefined>;
  readonly onAddScripts: (
    scripts: ReadonlyArray<ProjectScript>,
  ) => Promise<AtomCommandResult<void, unknown>>;
}

function reportFailure(title: string, error: unknown) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An unexpected error occurred.",
    }),
  );
}

function HeaderButton(props: {
  readonly label: string;
  readonly tooltip?: string;
  readonly children: ReactNode;
  readonly render: ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={props.render}>{props.children}</TooltipTrigger>
      <TooltipPopup side="bottom">{props.tooltip ?? props.label}</TooltipPopup>
    </Tooltip>
  );
}

const STATUS_DOT_CLASS = {
  success: "bg-success",
  info: "bg-info",
  warning: "bg-warning",
} as const;

function RunStatus(props: {
  readonly tone: keyof typeof STATUS_DOT_CLASS;
  readonly label: string;
}) {
  return (
    <Badge variant={props.tone}>
      <span aria-hidden className={`size-1.5 rounded-full ${STATUS_DOT_CLASS[props.tone]}`} />
      <span className={LABEL_CLASS}>{props.label}</span>
    </Badge>
  );
}

/** One-click run for the thread's project: starts the default action and previews its server. */
export const ProjectRunControl = memo(function ProjectRunControl(props: ProjectRunControlProps) {
  const { threadRef, project, cwd, scripts, preferredScriptId, onRunScript, onAddScripts } = props;
  const { environmentId, threadId } = threadRef;
  const threadKey = scopedThreadKey(threadRef);
  const navigate = useNavigate();
  const handleNewThread = useNewThreadHandler();
  const terminalActions = useThreadTerminalActions(threadRef);
  const closeDrawerTerminal = useTerminalUiStateStore((state) => state.closeTerminal);
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  const adjustPreview = useAtomCommand(previewEnvironment.adjust, { reportFailure: false });
  const canRun = useEnvironmentScope(environmentId, AuthTerminalOperateScope);
  const canReadTerminals = useEnvironmentScope(environmentId, AuthTerminalReadScope);
  const canOperatePreview = useEnvironmentScope(environmentId, AuthPreviewOperateScope);
  const previewAvailable = usePreviewAvailable(environmentId);
  const sessions = useKnownTerminalSessions({ environmentId, threadId });
  const runs = useProjectRunStore((state) => selectThreadRuns(state, threadKey));
  const [detecting, setDetecting] = useState(false);

  const terminals =
    sessions === null
      ? null
      : new Map(
          sessions.map((session) => [
            session.target.terminalId,
            {
              status: session.state.status,
              hasRunningSubprocess: session.state.hasRunningSubprocess,
            },
          ]),
        );
  const view = deriveProjectRunView({ scripts, preferredScriptId, runs, terminals });
  const previewRun =
    canOperatePreview && previewAvailable
      ? Object.values(runs).find((run) =>
          runAwaitsPreview(
            run,
            deriveProjectRunPhase(run, terminals),
            scripts.find((script) => script.id === run.scriptId),
          ),
        )
      : undefined;
  // Discovery only runs while a run waits for its server.
  const servers = useThreadDiscoveredPorts({
    environmentId: previewRun ? environmentId : null,
    threadId,
  });
  const previewServer = previewRun ? findRunServer(servers, threadId, previewRun) : null;
  const exitedTerminalId = view.phase === "exited" ? (view.run?.terminalId ?? null) : null;
  const exitedOutput = AsyncResult.getOrElse(
    useAtomValue(
      exitedTerminalId !== null && canReadTerminals
        ? terminalEnvironment.observe({
            environmentId,
            input: { threadId, terminalId: exitedTerminalId },
          })
        : NO_TERMINAL_OUTPUT_ATOM,
    ),
    () => null,
  )?.output;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- records what terminal metadata showed, which later decides between starting, ended and closed
  useEffect(() => {
    for (const run of Object.values(runs)) {
      // Finished non-play runs and terminals closed elsewhere leave nothing to show.
      if (deriveProjectRunPhase(run, terminals) === "idle") {
        forgetProjectRun(threadKey, run);
        continue;
      }
      const observed = observeProjectRun(run, terminals);
      if (observed !== run) replaceProjectRun(threadKey, observed);
    }
  }, [runs, terminals, threadKey]);

  /** A rerun reveals and reloads the tab an earlier run left on the same origin. */
  const showRunPreview = async (
    server: DiscoveredLocalServer,
  ): Promise<AtomCommandResult<void, unknown>> => {
    const preview = readThreadPreviewState(threadRef);
    const existing = findPreviewTabForUrls(preview, [
      server.url,
      resolveDiscoveredServerUrl(environmentId, server.url),
    ]);
    if (!existing) return openDiscoveredPort({ threadRef, port: server, openPreview });
    setActivePreviewTab(threadRef, existing.tabId);
    useRightPanelStore.getState().openBrowser(threadRef, existing.tabId);
    if (existing.runtime === "server") {
      const reloaded = await adjustPreview({
        environmentId,
        input: { threadId, tabId: existing.tabId, hardReload: true },
      });
      return mapAtomCommandResult(reloaded, () => undefined);
    }
    // A tab whose webview is not mounted yet loads its URL when revealed.
    await previewBridge
      ?.hardReload(previewRuntimeTabId(threadRef, preview.serverEpoch, existing.tabId))
      .catch(() => undefined);
    return AsyncResult.success(undefined);
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- opens the preview once when discovery attributes a server to the run's terminal
  useEffect(() => {
    if (!previewRun || !previewServer || !claimProjectRunPreview(threadKey, previewRun)) return;
    void showRunPreview(previewServer).then((result) => {
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        reportFailure("Could not open preview", squashAtomCommandFailure(result));
      }
    });
  }, [previewRun, previewServer, threadKey, showRunPreview]);

  const startRun = async (script: ProjectScript, options?: RunScriptOptions) => {
    const runId = beginProjectRun(threadKey, script);
    const terminalId = await onRunScript(script, options);
    if (terminalId === undefined) {
      forgetProjectRun(threadKey, { scriptId: script.id, id: runId });
      return;
    }
    attachProjectRunTerminal(threadKey, script.id, runId, terminalId);
  };

  const stopRun = (run: ProjectRun) => {
    forgetProjectRun(threadKey, run);
    if (run.terminalId === null) return;
    terminalActions.closeTerminalSession(run.terminalId);
    closeDrawerTerminal(threadRef, run.terminalId);
  };

  const restartRun = (run: ProjectRun, script: ProjectScript) => {
    stopRun(run);
    void startRun(script, { preferNewTerminal: true });
  };

  const openDraft = async (prompt: string) =>
    handleNewThread(scopeProjectRef(project.environmentId, project.id), { prompt }).catch(
      (error: unknown) => {
        reportFailure("Could not open a new thread", error);
        return null;
      },
    );

  /** "draft" when nothing runnable was found; null when the save failed and was reported. */
  const detectAndSave = async () => {
    const detection = detectRunTargets(await readRunDetectionFiles(environmentId, cwd));
    const detected = buildDetectedProjectScripts(
      detection.targets,
      scripts.map((script) => script.id),
    );
    if (detected.runScript === null) return "draft" as const;
    const saved = await onAddScripts(detected.scripts);
    if (saved._tag === "Failure") {
      if (!isAtomCommandInterrupted(saved)) {
        reportFailure("Could not save the detected actions", squashAtomCommandFailure(saved));
      }
      return null;
    }
    return { script: detected.runScript, installCommand: detection.installCommand };
  };

  const detectAndRun = async () => {
    setDetecting(true);
    // The React Compiler skips functions with try/finally, so a rejection settles here instead.
    const outcome = await detectAndSave().catch((error: unknown) => {
      reportFailure("Could not detect how to run this project", error);
      return null;
    });
    setDetecting(false);
    if (outcome === "draft") {
      await openDraft(noRunTargetPrompt());
      return;
    }
    if (outcome === null) return;
    await startRun(
      outcome.script,
      outcome.installCommand === null ? undefined : { setupCommand: outcome.installCommand },
    );
  };

  const handleRun = () => {
    if (!canRun) return;
    if (view.script) {
      void startRun(view.script);
      return;
    }
    if (!detecting) void detectAndRun();
  };

  const runRequested = useProjectRunStore((state) => selectProjectRunRequested(state, project));
  const startRequestedRun = useEffectEvent(handleRun);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- starts the run Home asked for, once, when this project's control shows
  useEffect(() => {
    if (!runRequested) return;
    // Run sets state, which an effect body must not do synchronously.
    const timer = setTimeout(() => {
      if (takeProjectRunRequest(project)) startRequestedRun();
    }, 0);
    return () => clearTimeout(timer);
  }, [project, runRequested]);

  const fix = async (exited: ProjectRun) => {
    const tail = exitedOutput
      ? terminalOutputTail(terminalOutputText(exitedOutput), FIX_OUTPUT_LINES)
      : null;
    const draft = await openDraft(runExitedPrompt(exited.command));
    if (!draft || !tail || exited.terminalId === null) return;
    useComposerDraftStore.getState().addTerminalContexts(draft.draftId, [
      {
        id: randomUUID(),
        threadId: draft.threadId,
        createdAt: new Date().toISOString(),
        terminalId: exited.terminalId,
        terminalLabel: getTerminalLabel(exited.terminalId),
        lineStart: tail.lineStart,
        lineEnd: tail.lineEnd,
        text: tail.text,
      },
    ]);
  };

  const openActionSettings = () => {
    void navigate({
      to: "/projects/$projectKey",
      params: {
        projectKey: deriveLogicalProjectKeyFromSettings(
          project,
          selectProjectGroupingSettings(getClientSettings()),
        ),
      },
    });
  };

  if (view.run && (view.phase === "starting" || view.phase === "running")) {
    const active = view.run;
    const running = view.phase === "running";
    return (
      <div className="flex shrink-0 items-center gap-1.5" role="group" aria-label="Project run">
        <RunStatus tone={running ? "success" : "info"} label={running ? "Running" : "Starting"} />
        <HeaderButton
          label="Restart"
          render={
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Restart"
              disabled={!canRun || active.terminalId === null || view.script === null}
              onClick={() => view.script && restartRun(active, view.script)}
            />
          }
        >
          <RotateCwIcon />
        </HeaderButton>
        <HeaderButton
          label="Stop"
          tooltip={`Stop ${active.command}`}
          render={
            <Button
              size="xs"
              variant="destructive-outline"
              aria-label="Stop"
              disabled={!canRun || active.terminalId === null}
              onClick={() => stopRun(active)}
            />
          }
        >
          <SquareIcon />
          <span className={LABEL_CLASS}>Stop</span>
        </HeaderButton>
      </div>
    );
  }

  const exited = view.phase === "exited" ? view.run : null;
  const runLabel = view.script ? `Run ${view.script.name}` : "Run";
  return (
    <div className="flex shrink-0 items-center gap-1.5" role="group" aria-label="Project run">
      {exited ? (
        <>
          <RunStatus tone="warning" label="Exited" />
          <HeaderButton
            label="Fix"
            tooltip="Ask an agent in a new thread why the run stopped"
            render={
              <Button
                size="xs"
                variant="outline"
                aria-label="Fix"
                onClick={() => void fix(exited)}
              />
            }
          >
            <WrenchIcon />
            <span className={LABEL_CLASS}>Fix</span>
          </HeaderButton>
        </>
      ) : null}
      <Group aria-label="Run project">
        <HeaderButton
          label="Run"
          tooltip={
            canRun
              ? view.script
                ? runLabel
                : "Detect how to run this project, then run it"
              : "Pair this client again with permission to run terminal commands."
          }
          render={
            <Button
              size="xs"
              aria-label={runLabel}
              aria-disabled={!canRun || detecting || undefined}
              onClick={handleRun}
            />
          }
        >
          <PlayIcon />
          <span className={LABEL_CLASS}>Run</span>
        </HeaderButton>
        <GroupSeparator />
        <Menu>
          <MenuTrigger
            render={<Button size="icon-xs" aria-label="Choose what to run" disabled={!canRun} />}
          >
            <ChevronDownIcon />
          </MenuTrigger>
          <MenuPopup align="end">
            {scripts.map((script) => (
              <MenuItem key={script.id} onClick={() => void startRun(script)}>
                <ScriptIcon icon={script.icon} className="size-4" />
                <MenuItemLabel>{projectScriptMenuLabel(script)}</MenuItemLabel>
              </MenuItem>
            ))}
            {scripts.length > 0 ? <MenuSeparator /> : null}
            <MenuItem onClick={openActionSettings}>
              <SettingsIcon className="size-4" />
              <MenuItemLabel>Edit actions…</MenuItemLabel>
            </MenuItem>
          </MenuPopup>
        </Menu>
      </Group>
      {exited ? (
        <HeaderButton
          label="Dismiss"
          render={
            <Button
              size="icon-xs"
              variant="ghost-muted"
              aria-label="Dismiss"
              onClick={() => forgetProjectRun(threadKey, exited)}
            />
          }
        >
          <XIcon />
        </HeaderButton>
      ) : null}
    </div>
  );
});
