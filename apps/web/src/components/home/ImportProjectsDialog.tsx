import {
  ensureBrowseDirectoryPath,
  inferProjectTitleFromPath,
} from "@t3tools/client-runtime/state/projects";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  FILESYSTEM_METADATA_BATCH_LIMIT,
  type EnvironmentId,
  type FilesystemBrowseEntry,
  type FilesystemEntryMetadata,
} from "@t3tools/contracts";
import { useId, useState } from "react";

import { newProjectId } from "../../lib/utils";
import { useProjects } from "../../state/entities";
import { filesystemEnvironment } from "../../state/filesystem";
import { projectEnvironment } from "../../state/projects";
import { useAtomCommand } from "../../state/use-atom-command";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Label } from "../ui/label";
import { stackedThreadToast, toastManager } from "../ui/toast";
import {
  buildImportCandidates,
  defaultImportSelection,
  foldersThatLookLikeProjects,
  importMarkerRequests,
  type ImportCandidate,
} from "./homeNewProject.logic";
import {
  FolderBrowser,
  NewProjectEnvironmentSelect,
  useNewProjectEnvironments,
} from "./NewProjectFields";

interface FoundFolders {
  readonly entries: readonly FilesystemBrowseEntry[];
  readonly projectFolders: ReadonlySet<string>;
}

type Step =
  | { readonly kind: "pick" }
  | { readonly kind: "loading" }
  | { readonly kind: "select"; readonly found: FoundFolders }
  | {
      readonly kind: "importing";
      readonly found: FoundFolders;
      readonly done: number;
      readonly total: number;
    }
  | {
      readonly kind: "failed";
      readonly found: FoundFolders;
      readonly failures: ReadonlyArray<{ readonly name: string; readonly message: string }>;
    };

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "An error occurred.";
}

/** Adds the projects found in a parent folder's subfolders, one create command each. */
export function ImportProjectsDialog(props: { readonly onClose: () => void }) {
  const id = useId();
  const environments = useNewProjectEnvironments();
  const projects = useProjects();
  const [environmentId, setEnvironmentId] = useState<EnvironmentId | null>(null);
  const environment =
    environments.find((candidate) => candidate.environmentId === environmentId) ??
    environments[0] ??
    null;
  const [pathOverride, setPathOverride] = useState<string | null>(null);
  const path =
    pathOverride ??
    environment?.settings?.addProjectBaseDirectory?.trim() ??
    environment?.newProjectsRoot ??
    "~/";
  const [step, setStep] = useState<Step>({ kind: "pick" });
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const browse = useAtomQueryRunner(filesystemEnvironment.browse, {
    reportFailure: false,
    refresh: true,
  });
  const getMetadata = useAtomQueryRunner(filesystemEnvironment.getMetadata, {
    reportFailure: false,
    refresh: true,
  });
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });

  const existingWorkspaceRoots = projects
    .filter((project) => project.environmentId === environment?.environmentId)
    .map((project) => project.workspaceRoot);

  const listSubfolders = async () => {
    if (!environment) return;
    setError(null);
    setStep({ kind: "loading" });
    const listed = await browse({
      environmentId: environment.environmentId,
      input: { partialPath: ensureBrowseDirectoryPath(path) },
    });
    if (listed._tag === "Failure") {
      setError("That folder could not be read.");
      setStep({ kind: "pick" });
      return;
    }
    const entries = listed.value.entries.filter((entry) => !entry.name.startsWith("."));
    const requests = importMarkerRequests(entries);
    const metadata: Array<FilesystemEntryMetadata | null> = [];
    for (let start = 0; start < requests.length; start += FILESYSTEM_METADATA_BATCH_LIMIT) {
      const batch = requests.slice(start, start + FILESYSTEM_METADATA_BATCH_LIMIT);
      const result = await getMetadata({
        environmentId: environment.environmentId,
        input: { paths: batch.map((request) => request.path) },
      });
      // Without metadata nothing is pre-checked, but every folder can still be picked.
      metadata.push(...(result._tag === "Success" ? result.value.entries : batch.map(() => null)));
    }
    const found = { entries, projectFolders: foldersThatLookLikeProjects(requests, metadata) };
    setSelected(
      defaultImportSelection(buildImportCandidates({ ...found, existingWorkspaceRoots })),
    );
    setStep({ kind: "select", found });
  };

  const importSelected = async (found: FoundFolders, candidates: readonly ImportCandidate[]) => {
    if (!environment) return;
    const chosen = candidates.filter(
      (candidate) => selected.has(candidate.path) && !candidate.alreadyAdded,
    );
    const failures: Array<{ name: string; message: string }> = [];
    for (const [index, candidate] of chosen.entries()) {
      setStep({ kind: "importing", found, done: index, total: chosen.length });
      const result = await createProject({
        environmentId: environment.environmentId,
        input: {
          projectId: newProjectId(),
          title: inferProjectTitleFromPath(candidate.path),
          workspaceRoot: candidate.path,
          createWorkspaceRootIfMissing: false,
          defaultModelSelection: null,
        },
      });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        failures.push({
          name: candidate.name,
          message: errorMessage(squashAtomCommandFailure(result)),
        });
      }
    }
    const added = chosen.length - failures.length;
    if (added > 0) {
      toastManager.add(
        stackedThreadToast({
          type: "success",
          title: `Imported ${added} ${added === 1 ? "project" : "projects"}`,
        }),
      );
    }
    if (failures.length === 0) {
      props.onClose();
      return;
    }
    setSelected(new Set());
    setStep({ kind: "failed", found, failures });
  };

  const found = step.kind === "pick" || step.kind === "loading" ? null : step.found;
  // Built from live projects, so ones added meanwhile, here or elsewhere, grey out.
  const candidates =
    found === null ? null : buildImportCandidates({ ...found, existingWorkspaceRoots });
  const selectedCount = (candidates ?? []).filter(
    (candidate) => !candidate.alreadyAdded && selected.has(candidate.path),
  ).length;
  const busy = step.kind === "loading" || step.kind === "importing";

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) props.onClose();
      }}
    >
      <DialogPopup className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Import projects from a folder</DialogTitle>
          <DialogDescription>
            {candidates === null
              ? "Pick the folder that holds your projects. Each subfolder you choose becomes a project."
              : `Subfolders of ${path.trim()}`}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {environment === null ? (
            <p className="text-sm text-muted-foreground">
              No connected machine can add projects right now.
            </p>
          ) : candidates === null || found === null ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <Label htmlFor={`${id}-path`} className="flex-1">
                  Parent folder
                </Label>
                <NewProjectEnvironmentSelect
                  environments={environments}
                  value={environment.environmentId}
                  onValueChange={(next) => {
                    setEnvironmentId(next);
                    setPathOverride(null);
                  }}
                />
              </div>
              <FolderBrowser
                id={`${id}-path`}
                environment={environment}
                path={path}
                onPathChange={setPathOverride}
              />
            </div>
          ) : (
            <ImportCandidateList
              candidates={candidates}
              selected={selected}
              disabled={busy}
              onSelectedChange={setSelected}
            />
          )}
          {step.kind === "failed" ? (
            <div className="flex flex-col gap-1 rounded-md border border-destructive/40 p-2.5">
              <p className="text-sm font-medium text-destructive-foreground">
                {step.failures.length} {step.failures.length === 1 ? "project" : "projects"} could
                not be added
              </p>
              {step.failures.map((failure) => (
                <p key={failure.name} className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{failure.name}</span>:{" "}
                  {failure.message}
                </p>
              ))}
            </div>
          ) : null}
          {error ? <p className="text-sm text-destructive-foreground">{error}</p> : null}
        </DialogPanel>
        <DialogFooter>
          {candidates === null ? (
            <>
              <Button type="button" variant="outline" onClick={props.onClose}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={environment === null || path.trim().length === 0 || busy}
                onClick={() => void listSubfolders()}
              >
                {step.kind === "loading" ? "Looking…" : "Find projects"}
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setStep({ kind: "pick" })}
              >
                Back
              </Button>
              <Button
                type="button"
                disabled={selectedCount === 0 || busy || found === null}
                onClick={() => {
                  if (found !== null) void importSelected(found, candidates);
                }}
              >
                {step.kind === "importing"
                  ? `Importing ${step.done + 1} of ${step.total}…`
                  : `Import ${selectedCount} ${selectedCount === 1 ? "project" : "projects"}`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function ImportCandidateList(props: {
  readonly candidates: readonly ImportCandidate[];
  readonly selected: ReadonlySet<string>;
  readonly disabled: boolean;
  readonly onSelectedChange: (selected: ReadonlySet<string>) => void;
}) {
  const available = props.candidates.filter((candidate) => !candidate.alreadyAdded);
  const selectedCount = available.filter((candidate) => props.selected.has(candidate.path)).length;
  const allSelected = available.length > 0 && selectedCount === available.length;
  if (props.candidates.length === 0) {
    return <p className="text-sm text-muted-foreground">This folder has no subfolders.</p>;
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-xs text-muted-foreground">
          {selectedCount} of {available.length} selected
        </span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={props.disabled || available.length === 0}
          onClick={() =>
            props.onSelectedChange(
              allSelected ? new Set() : new Set(available.map((candidate) => candidate.path)),
            )
          }
        >
          {allSelected ? "Select none" : "Select all"}
        </Button>
      </div>
      <div className="max-h-80 overflow-y-auto rounded-md border">
        {props.candidates.map((candidate) => (
          <label
            key={candidate.path}
            className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-sm not-last:border-b has-disabled:cursor-not-allowed has-disabled:opacity-64"
          >
            <Checkbox
              checked={candidate.alreadyAdded || props.selected.has(candidate.path)}
              disabled={candidate.alreadyAdded || props.disabled}
              onCheckedChange={(checked) => {
                const next = new Set(props.selected);
                if (checked) next.add(candidate.path);
                else next.delete(candidate.path);
                props.onSelectedChange(next);
              }}
            />
            <span className="min-w-0 flex-1 truncate">{candidate.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {candidate.alreadyAdded
                ? "Already added"
                : candidate.looksLikeProject
                  ? "Project"
                  : null}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
