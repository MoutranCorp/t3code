import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  CircleCheckIcon,
  CircleDotIcon,
  CircleStopIcon,
  CircleXIcon,
  GitBranchIcon,
  HistoryIcon,
  MessageSquareIcon,
  MessageSquarePlusIcon,
  type LucideIcon,
} from "lucide-react";
import { memo, useState } from "react";

import { buildThreadRouteParams } from "../../threadRoutes";
import type { SidebarThreadSummary } from "../../types";
import { RelativeTime } from "../RelativeTime";
import { ThreadRowLeadingStatus, ThreadRowTrailingStatus } from "../ThreadStatusIndicators";
import { Button } from "../ui/button";
import {
  deriveProjectActivity,
  type ProjectActivityEntry,
  type ProjectActivityKind,
} from "./projectScreen.logic";
import { ProjectSection, ProjectSectionEmpty } from "./ProjectSection";

const COLLAPSED_THREAD_COUNT = 8;
const ACTIVITY_LIMIT = 8;

const ROW_CLASS =
  "flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";

function useOpenThread() {
  const navigate = useNavigate();
  return (environmentId: EnvironmentId, threadId: ThreadId) =>
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(environmentId, threadId)),
    });
}

const ProjectThreadRow = memo(function ProjectThreadRow(props: {
  readonly thread: SidebarThreadSummary;
  readonly onOpen: (environmentId: EnvironmentId, threadId: ThreadId) => void;
}) {
  const { thread } = props;
  return (
    <li>
      <button
        type="button"
        className={ROW_CLASS}
        onClick={() => props.onOpen(thread.environmentId, thread.id)}
      >
        <MessageSquareIcon aria-hidden className="size-4 shrink-0 text-muted-foreground/70" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm font-medium text-foreground">{thread.title}</span>
          {thread.branch ? (
            <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
              <GitBranchIcon aria-hidden className="size-3 shrink-0" />
              <span className="truncate font-mono">{thread.branch}</span>
            </span>
          ) : null}
        </span>
        <ThreadRowLeadingStatus thread={thread} />
        <ThreadRowTrailingStatus thread={thread} />
        <span className="w-16 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
          <RelativeTime timestamp={thread.latestUserMessageAt ?? thread.updatedAt} />
        </span>
      </button>
    </li>
  );
});

export function ProjectThreadsSection(props: {
  /** Newest first. */
  readonly threads: ReadonlyArray<SidebarThreadSummary>;
  readonly onNewThread: () => void;
}) {
  const openThread = useOpenThread();
  const [expanded, setExpanded] = useState(false);
  const { threads } = props;
  const shown = expanded ? threads : threads.slice(0, COLLAPSED_THREAD_COUNT);
  const hiddenCount = threads.length - shown.length;
  return (
    <ProjectSection
      title="Threads"
      icon={MessageSquareIcon}
      action={
        threads.length > 0 ? (
          <span className="text-xs text-muted-foreground tabular-nums">{threads.length}</span>
        ) : null
      }
    >
      {threads.length === 0 ? (
        <ProjectSectionEmpty
          title="No threads yet"
          description="Start a thread to put an agent to work on this project."
        >
          <Button size="sm" onClick={props.onNewThread}>
            <MessageSquarePlusIcon aria-hidden />
            New thread
          </Button>
        </ProjectSectionEmpty>
      ) : (
        <>
          <ul aria-label="Threads" className="flex flex-col gap-0.5 px-2 pb-2">
            {shown.map((thread) => (
              <ProjectThreadRow
                key={`${thread.environmentId}:${thread.id}`}
                thread={thread}
                onOpen={openThread}
              />
            ))}
          </ul>
          {hiddenCount > 0 || expanded ? (
            <div className="border-t border-border/60 px-3 py-2">
              <Button variant="ghost" size="sm" onClick={() => setExpanded((value) => !value)}>
                {expanded ? "Show fewer" : `Show all ${threads.length} threads`}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </ProjectSection>
  );
}

const ACTIVITY_PRESENTATION: Record<
  ProjectActivityKind,
  { readonly icon: LucideIcon; readonly label: string; readonly className: string }
> = {
  created: {
    icon: MessageSquarePlusIcon,
    label: "Thread started",
    className: "text-muted-foreground",
  },
  working: { icon: CircleDotIcon, label: "Agent working", className: "text-info" },
  completed: { icon: CircleCheckIcon, label: "Finished", className: "text-success" },
  failed: { icon: CircleXIcon, label: "Failed", className: "text-destructive" },
  stopped: { icon: CircleStopIcon, label: "Stopped", className: "text-muted-foreground" },
};

function ProjectActivityRow(props: {
  readonly entry: ProjectActivityEntry;
  readonly onOpen: (environmentId: EnvironmentId, threadId: ThreadId) => void;
}) {
  const { entry } = props;
  const presentation = ACTIVITY_PRESENTATION[entry.kind];
  const Icon = presentation.icon;
  return (
    <li>
      <button
        type="button"
        className={ROW_CLASS}
        onClick={() => props.onOpen(entry.environmentId, entry.threadId)}
      >
        <Icon aria-hidden className={`size-4 shrink-0 ${presentation.className}`} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">{presentation.label}</span>
          <span className="truncate text-sm text-foreground">{entry.title}</span>
        </span>
        <span className="w-16 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
          <RelativeTime timestamp={entry.at} />
        </span>
      </button>
    </li>
  );
}

export function ProjectActivitySection(props: {
  readonly threads: ReadonlyArray<SidebarThreadSummary>;
}) {
  const openThread = useOpenThread();
  const activity = deriveProjectActivity(props.threads, ACTIVITY_LIMIT);
  return (
    <ProjectSection title="Recent activity" icon={HistoryIcon}>
      {activity.length === 0 ? (
        <ProjectSectionEmpty
          title="Nothing yet"
          description="Thread starts and finished runs show up here."
        />
      ) : (
        <ul aria-label="Recent activity" className="flex flex-col gap-0.5 px-2 pb-2">
          {activity.map((entry) => (
            <ProjectActivityRow key={entry.key} entry={entry} onOpen={openThread} />
          ))}
        </ul>
      )}
    </ProjectSection>
  );
}
