import type { EnvironmentId } from "@t3tools/contracts";
import { ArrowDownIcon, ArrowUpIcon, FileDiffIcon, GitBranchIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useEnvironmentQuery } from "~/state/query";
import { vcsEnvironment } from "~/state/vcs";
import { ProjectSection, ProjectSectionEmpty } from "./ProjectSection";

function GitStat(props: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl bg-muted/50 px-3 py-2.5">
      <dt className="text-xs text-muted-foreground">{props.label}</dt>
      <dd className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-foreground tabular-nums">
        {props.children}
      </dd>
    </div>
  );
}

export function ProjectGitSection(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
}) {
  const status = useEnvironmentQuery(
    vcsEnvironment.status({ environmentId: props.environmentId, input: { cwd: props.cwd } }),
  );
  const git = status.data;
  const changedFiles = git?.workingTree.files.length ?? 0;
  return (
    <ProjectSection title="Git" icon={GitBranchIcon}>
      {git === null ? (
        status.error ? (
          <ProjectSectionEmpty title="Git status unavailable" description={status.error} />
        ) : (
          <p className="px-5 pt-1 pb-5 text-sm text-muted-foreground">Reading git status…</p>
        )
      ) : !git.isRepo ? (
        <ProjectSectionEmpty
          title="Not a git repository"
          description="Initialize git in this folder to track branches and changes."
        />
      ) : (
        <div className="flex flex-col gap-3 px-5 pt-1 pb-5">
          <div className="flex min-w-0 items-center gap-2">
            <GitBranchIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate font-mono text-sm font-medium text-foreground">
              {git.refName ?? "Detached HEAD"}
            </span>
            {git.isDefaultRef ? (
              <span className="shrink-0 text-xs text-muted-foreground">default</span>
            ) : null}
          </div>
          <dl className="grid grid-cols-2 gap-2">
            <GitStat label="Sync">
              {git.hasUpstream ? (
                <>
                  <span
                    className="flex items-center gap-0.5"
                    aria-label={`${git.aheadCount} ahead`}
                  >
                    <ArrowUpIcon aria-hidden className="size-3.5 text-muted-foreground" />
                    {git.aheadCount}
                  </span>
                  <span
                    className="flex items-center gap-0.5"
                    aria-label={`${git.behindCount} behind`}
                  >
                    <ArrowDownIcon aria-hidden className="size-3.5 text-muted-foreground" />
                    {git.behindCount}
                  </span>
                </>
              ) : (
                <span className="font-normal text-muted-foreground">
                  {git.hasPrimaryRemote ? "Not published" : "No remote"}
                </span>
              )}
            </GitStat>
            <GitStat label="Changes">
              <FileDiffIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              {changedFiles === 0 ? (
                <span className="font-normal text-muted-foreground">Clean</span>
              ) : (
                <>
                  <span>
                    {changedFiles} {changedFiles === 1 ? "file" : "files"}
                  </span>
                  <span className="truncate text-xs font-normal">
                    <span className="text-success">+{git.workingTree.insertions}</span>{" "}
                    <span className="text-destructive">−{git.workingTree.deletions}</span>
                  </span>
                </>
              )}
            </GitStat>
          </dl>
        </div>
      )}
    </ProjectSection>
  );
}
