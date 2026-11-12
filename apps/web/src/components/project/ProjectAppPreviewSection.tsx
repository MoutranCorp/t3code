import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { AuthPreviewOperateScope, type ScopedProjectRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ExternalLinkIcon, MonitorPlayIcon, PanelRightIcon, PlayIcon } from "lucide-react";

import { resolveDiscoveredServerUrl } from "~/browser/browserTargetResolver";
import { useComposerDraftStore } from "~/composerDraftStore";
import { ensureLocalApi } from "~/localApi";
import { useThreadDiscoveredPorts } from "~/portDiscoveryState";
import { readThreadPreviewState, setActivePreviewTab } from "~/previewStateStore";
import { selectThreadRuns, useProjectRunStore } from "~/projectRunStore";
import { useRightPanelStore } from "~/rightPanelStore";
import { previewEnvironment } from "~/state/preview";
import { useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import { buildThreadRouteParams } from "~/threadRoutes";
import type { SidebarThreadSummary } from "~/types";
import { findPreviewTabForUrls, findRunServer } from "../chat/projectRunControl.logic";
import { useAppRunningThreadKeys } from "../home/useAppRunningThreadKeys";
import { openDiscoveredPort } from "../preview/openDiscoveredPort";
import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { findRunningAppThread, type RunningAppThread } from "./projectScreen.logic";
import { ProjectSection, ProjectSectionEmpty } from "./ProjectSection";

function reportFailure(title: string, error: unknown) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An unexpected error occurred.",
    }),
  );
}

function RunningApp(props: { readonly target: RunningAppThread }) {
  const { environmentId, threadId, draftId } = props.target;
  const threadRef = scopeThreadRef(environmentId, threadId);
  const navigate = useNavigate();
  const canOperatePreview = useEnvironmentScope(environmentId, AuthPreviewOperateScope);
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  const runs = useProjectRunStore((state) => selectThreadRuns(state, scopedThreadKey(threadRef)));
  const servers = useThreadDiscoveredPorts({
    environmentId: canOperatePreview ? environmentId : null,
    threadId,
  });
  const server =
    Object.values(runs)
      .map((run) => findRunServer(servers, threadId, run))
      .find((candidate) => candidate !== null) ??
    servers[0] ??
    null;
  const url = server ? resolveDiscoveredServerUrl(environmentId, server.url) : null;

  const openThread = () =>
    draftId === null
      ? navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(threadRef) })
      : navigate({ to: "/draft/$draftId", params: { draftId } });

  const openInPreview = async () => {
    await openThread();
    if (!server || url === null) return;
    const existing = findPreviewTabForUrls(readThreadPreviewState(threadRef), [server.url, url]);
    if (existing) {
      setActivePreviewTab(threadRef, existing.tabId);
      useRightPanelStore.getState().openBrowser(threadRef, existing.tabId);
      return;
    }
    const result = await openDiscoveredPort({ threadRef, port: server, openPreview });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      reportFailure("Could not open preview", squashAtomCommandFailure(result));
    }
  };

  return (
    <div className="flex flex-col gap-4 px-5 pt-1 pb-5">
      <div className="flex min-w-0 items-center gap-3 rounded-xl bg-success/8 px-3 py-2.5 dark:bg-success/12">
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-success" />
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-medium text-foreground">
            {url ? "Running" : "Starting…"}
          </span>
          {url ? (
            <span className="truncate font-mono text-xs text-muted-foreground">{url}</span>
          ) : (
            <span className="text-xs text-muted-foreground">Waiting for its local server.</span>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() =>
            void openInPreview().catch((error) => reportFailure("Could not open preview", error))
          }
        >
          <PanelRightIcon aria-hidden />
          {url ? "Open preview" : "Open thread"}
        </Button>
        {url ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void ensureLocalApi()
                .shell.openExternal(url)
                .catch((error: unknown) => reportFailure("Unable to open in browser", error))
            }
          >
            <ExternalLinkIcon aria-hidden />
            Open in browser
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function ProjectAppPreviewSection(props: {
  readonly refs: ReadonlyArray<ScopedProjectRef>;
  /** Newest first. */
  readonly threads: ReadonlyArray<SidebarThreadSummary>;
  readonly canRun: boolean;
  readonly onRun: () => void;
}) {
  const appRunningThreadKeys = useAppRunningThreadKeys();
  const drafts = useComposerDraftStore((state) => state.draftThreadsByThreadKey);
  const running = findRunningAppThread({
    refs: props.refs,
    threads: props.threads,
    drafts,
    appRunningThreadKeys,
  });
  return (
    <ProjectSection title="App preview" icon={MonitorPlayIcon}>
      {running ? (
        <RunningApp key={`${running.environmentId}:${running.threadId}`} target={running} />
      ) : (
        <ProjectSectionEmpty
          title="Not running"
          description="Run the app to preview it here and in the thread's browser panel."
        >
          <Button size="sm" variant="outline" disabled={!props.canRun} onClick={props.onRun}>
            <PlayIcon aria-hidden />
            Run app
          </Button>
        </ProjectSectionEmpty>
      )}
    </ProjectSection>
  );
}
