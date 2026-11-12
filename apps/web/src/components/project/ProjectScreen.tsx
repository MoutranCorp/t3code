import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { sortThreads } from "@t3tools/client-runtime/state/thread-sort";
import { AuthTerminalOperateScope, type EnvironmentId, type ProjectId } from "@t3tools/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  FolderTreeIcon,
  MessageSquarePlusIcon,
  PlayIcon,
  SearchXIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { isElectron } from "../../env";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useClientSettings } from "../../hooks/useSettings";
import { useSidebarProjectGroups } from "../../hooks/useSidebarProjectGroups";
import { cn } from "../../lib/utils";
import { workspaceAreaProps } from "../../lib/workspaceFocus";
import { requestProjectRun } from "../../projectRunStore";
import {
  useAllEnvironmentShellsBootstrapped,
  useDelegatedUnderParent,
  useProject,
  useQuietThreadShells,
} from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { buildThreadRouteParams } from "../../threadRoutes";
import { OpenInPicker } from "../chat/OpenInPicker";
import FileBrowserPanel from "../files/FileBrowserPanel";
import { HomeProjectIcon } from "../home/HomeProjectTile";
import { useAppRunningThreadKeys } from "../home/useAppRunningThreadKeys";
import { ProjectFavicon } from "../ProjectFavicon";
import { filterSidebarV2VisibleThreads } from "../Sidebar.logic";
import { StartTruncatedPath } from "../StartTruncatedPath";
import { Button } from "../ui/button";
import { SidebarInset } from "../ui/sidebar";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { ProjectAppPreviewSection } from "./ProjectAppPreviewSection";
import { ProjectFilesView } from "./ProjectFilesView";
import { ProjectGitSection } from "./ProjectGitSection";
import { findProjectGroup, findRunningAppThread } from "./projectScreen.logic";
import { ProjectSection } from "./ProjectSection";
import { ProjectActivitySection, ProjectThreadsSection } from "./ProjectThreadsSection";
import { useProjectOpenIn } from "./useProjectOpenIn";

type ProjectView = "overview" | "files";

const PAGE_CLASS =
  "relative flex min-h-0 min-w-0 flex-1 flex-col bg-background bg-linear-to-b from-info/22 via-info/6 via-50% to-primary/8";

function reportFailure(title: string, error: unknown) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An unexpected error occurred.",
    }),
  );
}

function BackToHome() {
  return (
    <Button variant="ghost" size="sm" render={<Link to="/home" />}>
      <ArrowLeftIcon aria-hidden />
      Home
    </Button>
  );
}

function ProjectPage(props: { readonly children: ReactNode }) {
  const contentArea = workspaceAreaProps("project", 1, "Project");
  return (
    <SidebarInset
      {...contentArea}
      role="main"
      className="h-dvh min-h-0 overflow-hidden overscroll-y-none"
    >
      <div className={PAGE_CLASS}>
        {/* The desktop window only moves where CSS opts in, so keep a titlebar strip. */}
        {isElectron ? <WorkspacePageHeader electron /> : null}
        {props.children}
      </div>
    </SidebarInset>
  );
}

function ProjectMissing() {
  return (
    <ProjectPage>
      <div className={cn("px-6", !isElectron && "pt-6")}>
        <BackToHome />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <SearchXIcon aria-hidden className="size-8 text-muted-foreground/60" />
        <p className="text-base font-medium text-foreground">This project is not here anymore</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          It may have been removed, or its machine is not connected.
        </p>
      </div>
    </ProjectPage>
  );
}

export function ProjectScreen(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}) {
  const projectRef = scopeProjectRef(props.environmentId, props.projectId);
  const navigate = useNavigate();
  const handleNewThread = useNewThreadHandler();
  const project = useProject(projectRef);
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const group = findProjectGroup(useSidebarProjectGroups(), projectRef);
  const allThreads = useQuietThreadShells();
  const delegatedUnderParent = useDelegatedUnderParent();
  const sortOrder = useClientSettings((settings) => settings.sidebarThreadSortOrder);
  const appRunningThreadKeys = useAppRunningThreadKeys();
  const drafts = useComposerDraftStore((state) => state.draftThreadsByThreadKey);
  const canRun = useEnvironmentScope(props.environmentId, AuthTerminalOperateScope);
  const projectName = group?.displayName ?? project?.title ?? "";
  const openIn = useProjectOpenIn(props.environmentId, projectName);
  const [view, setView] = useState<ProjectView>("overview");
  const [openPath, setOpenPath] = useState<string | null>(null);

  if (!project) return bootstrapped ? <ProjectMissing /> : <ProjectPage>{null}</ProjectPage>;

  const memberRefs = group?.memberProjectRefs ?? [projectRef];
  const threads = sortThreads(
    filterSidebarV2VisibleThreads(
      allThreads,
      new Set(memberRefs.map((ref) => `${ref.environmentId}:${ref.projectId}`)),
      delegatedUnderParent,
    ),
    sortOrder,
  );
  const appRunning =
    findRunningAppThread({ refs: memberRefs, threads, drafts, appRunningThreadKeys }) !== null;

  const newThread = () => {
    void handleNewThread(projectRef).catch((error: unknown) =>
      reportFailure("Could not open a new thread", error),
    );
  };

  // Like Home's Run app: the project's Run control starts the run once its thread shows.
  const runApp = () => {
    const latest = threads[0];
    const runRef = latest ? scopeProjectRef(latest.environmentId, latest.projectId) : projectRef;
    requestProjectRun(runRef);
    const opened = latest
      ? navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(scopeThreadRef(latest.environmentId, latest.id)),
        })
      : handleNewThread(runRef);
    void opened.catch((error: unknown) => reportFailure("Could not run the app", error));
  };

  const openFile = (relativePath: string | null) => {
    setOpenPath(relativePath);
    if (relativePath !== null) setView("files");
  };

  return (
    <ProjectPage>
      <header className={cn("shrink-0 px-6 pb-5", !isElectron && "pt-5")}>
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
          <div>
            <BackToHome />
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
            <div className="flex min-w-0 flex-1 items-center gap-4">
              {group ? (
                <HomeProjectIcon project={group} size="dock" attention={0} working={false} />
              ) : (
                <span className="flex size-15 shrink-0 items-center justify-center rounded-2xl bg-card shadow-sm ring-1 ring-border/60">
                  <ProjectFavicon project={project} className="size-8" />
                </span>
              )}
              <div className="flex min-w-0 flex-col gap-0.5">
                <h1 className="truncate text-2xl font-semibold tracking-tight text-foreground">
                  {projectName}
                </h1>
                <StartTruncatedPath
                  path={project.workspaceRoot}
                  className="font-mono text-xs text-muted-foreground"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {openIn.show ? (
                <OpenInPicker
                  environmentId={props.environmentId}
                  keybindings={openIn.keybindings}
                  availableEditors={openIn.availableEditors}
                  openInCwd={project.workspaceRoot}
                  enableShortcut={false}
                />
              ) : null}
              {appRunning ? null : (
                <Button size="sm" variant="outline" disabled={!canRun} onClick={runApp}>
                  <PlayIcon aria-hidden />
                  Run app
                </Button>
              )}
              <Button size="sm" onClick={newThread}>
                <MessageSquarePlusIcon aria-hidden />
                New thread
              </Button>
            </div>
          </div>
          <ToggleGroup
            aria-label="Project view"
            value={[view]}
            onValueChange={(next) => {
              const value = next[0];
              if (value === "overview" || value === "files") setView(value);
            }}
          >
            <Toggle value="overview">Overview</Toggle>
            <Toggle value="files">Files</Toggle>
          </ToggleGroup>
        </div>
      </header>
      {view === "overview" ? (
        // Focus that lands on the page stops here, not in the Files card search below.
        <div
          tabIndex={-1}
          data-workspace-focus-default
          className="min-h-0 flex-1 overflow-y-auto px-6 pb-12 outline-none scrollbar-gutter-both"
        >
          <div className="mx-auto grid w-full max-w-6xl items-start gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="flex min-w-0 flex-col gap-5">
              <ProjectThreadsSection threads={threads} onNewThread={newThread} />
              <ProjectActivitySection threads={threads} />
            </div>
            <div className="flex min-w-0 flex-col gap-5">
              <ProjectAppPreviewSection
                refs={memberRefs}
                threads={threads}
                canRun={canRun}
                onRun={runApp}
              />
              <ProjectGitSection environmentId={props.environmentId} cwd={project.workspaceRoot} />
              <ProjectSection title="Files" icon={FolderTreeIcon} className="h-96 overflow-hidden">
                <div className="flex min-h-0 flex-1 flex-col border-t border-border/60">
                  <FileBrowserPanel
                    environmentId={props.environmentId}
                    cwd={project.workspaceRoot}
                    projectName={projectName}
                    selectedPath={null}
                    selectedPathRevealId={0}
                    onOpenFile={openFile}
                    workspaceMutationId={null}
                  />
                </div>
              </ProjectSection>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 px-6 pb-6">
          <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1">
            <ProjectFilesView
              environmentId={props.environmentId}
              cwd={project.workspaceRoot}
              projectName={projectName}
              openPath={openPath}
              onOpenPath={setOpenPath}
            />
          </div>
        </div>
      )}
    </ProjectPage>
  );
}
