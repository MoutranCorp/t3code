import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { getCloneDestinationPath } from "@t3tools/client-runtime/operations/projects";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { useId, useState } from "react";

import { requestDraftAutoSend } from "../../draftAutoSendStore";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { newProjectId } from "../../lib/utils";
import { useProjects, waitForProject } from "../../state/entities";
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
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import {
  isValidProjectFolderName,
  latestProjectParent,
  suggestProjectName,
} from "./homeNewProject.logic";
import {
  FolderBrowser,
  NewProjectEnvironmentSelect,
  useNewProjectEnvironments,
} from "./NewProjectFields";

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "An error occurred.";
}

/**
 * Makes a folder and a project from a description, then opens a new thread on the user's
 * default model with the description as its first message, sent unless the user opts out.
 */
export function DescribeProjectDialog(props: { readonly onClose: () => void }) {
  const id = useId();
  const environments = useNewProjectEnvironments();
  const projects = useProjects();
  const handleNewThread = useNewThreadHandler();
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const getMetadata = useAtomQueryRunner(filesystemEnvironment.getMetadata, {
    reportFailure: false,
    refresh: true,
  });
  const [environmentId, setEnvironmentId] = useState<EnvironmentId | null>(null);
  const environment =
    environments.find((candidate) => candidate.environmentId === environmentId) ??
    environments[0] ??
    null;
  const [description, setDescription] = useState("");
  const [nameOverride, setNameOverride] = useState<string | null>(null);
  const [locationOverride, setLocationOverride] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [startNow, setStartNow] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once the folder turned out to exist, so the next Create uses it as it is.
  const [confirmedExisting, setConfirmedExisting] = useState<string | null>(null);

  const name = nameOverride ?? suggestProjectName(description);
  const location =
    locationOverride ??
    latestProjectParent(
      projects.filter((project) => project.environmentId === environment?.environmentId),
    ) ??
    environment?.newProjectsRoot ??
    environment?.settings?.addProjectBaseDirectory?.trim() ??
    "~/";
  const targetPath =
    location.trim().length > 0 && isValidProjectFolderName(name)
      ? getCloneDestinationPath(location.trim(), name.trim())
      : null;
  const canCreate =
    environment !== null && description.trim().length > 0 && targetPath !== null && !submitting;

  const create = async () => {
    if (!canCreate || environment === null || targetPath === null) return;
    setSubmitting(true);
    setError(null);
    try {
      if (confirmedExisting !== targetPath) {
        const existing = await getMetadata({
          environmentId: environment.environmentId,
          input: { paths: [targetPath] },
        });
        const entry = existing._tag === "Success" ? existing.value.entries[0] : null;
        if (entry?.kind === "directory") {
          setConfirmedExisting(targetPath);
          setError(`${targetPath} already exists. Create again to use it as the project folder.`);
          return;
        }
        if (entry) {
          setError(`${targetPath} is a file. Pick another name.`);
          return;
        }
      }
      const projectRef = scopeProjectRef(environment.environmentId, newProjectId());
      const created = await createProject({
        environmentId: environment.environmentId,
        input: {
          projectId: projectRef.projectId,
          title: name.trim(),
          workspaceRoot: targetPath,
          createWorkspaceRootIfMissing: true,
          defaultModelSelection: null,
        },
      });
      if (created._tag === "Failure") {
        if (!isAtomCommandInterrupted(created)) {
          setError(errorMessage(squashAtomCommandFailure(created)));
        }
        return;
      }
      // Drafts key on the stored project path, so wait for it before opening one.
      await waitForProject(projectRef);
      props.onClose();
      const opened = await handleNewThread(projectRef, { prompt: description.trim() });
      if (opened && startNow) requestDraftAutoSend(opened.draftId);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting) props.onClose();
      }}
    >
      <DialogPopup className="sm:max-w-xl">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>
              Describe it and T3 Code makes the folder, then starts an agent on it.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            {environment === null ? (
              <p className="text-sm text-muted-foreground">
                No connected machine can add projects right now.
              </p>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${id}-description`}>What do you want to build?</Label>
                  <Textarea
                    id={`${id}-description`}
                    autoFocus
                    rows={5}
                    value={description}
                    placeholder="A recipe planner that turns my week's meals into a shopping list…"
                    onChange={(event) => setDescription(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                        event.preventDefault();
                        void create();
                      }
                    }}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${id}-name`}>Project name</Label>
                  <Input
                    id={`${id}-name`}
                    value={name}
                    placeholder="recipe-planner"
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(event) => {
                      setNameOverride(event.target.value);
                    }}
                  />
                  {name.trim().length > 0 && !isValidProjectFolderName(name) ? (
                    <p className="text-xs text-destructive-foreground">
                      Use a folder name without slashes or special characters.
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`${id}-location`} className="flex-1">
                      Location
                    </Label>
                    <NewProjectEnvironmentSelect
                      environments={environments}
                      value={environment.environmentId}
                      onValueChange={(next) => {
                        setEnvironmentId(next);
                        setLocationOverride(null);
                      }}
                    />
                    {browsing ? null : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() => setBrowsing(true)}
                      >
                        Change…
                      </Button>
                    )}
                  </div>
                  {browsing ? (
                    <FolderBrowser
                      id={`${id}-location`}
                      environment={environment}
                      path={location}
                      onPathChange={(next) => {
                        setLocationOverride(next);
                      }}
                    />
                  ) : (
                    <p id={`${id}-location`} className="truncate text-xs text-muted-foreground">
                      {targetPath ?? location}
                    </p>
                  )}
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    checked={startNow}
                    onCheckedChange={(checked) => setStartNow(checked === true)}
                  />
                  Start the agent right away
                </label>
              </>
            )}
            {error ? <p className="text-sm text-destructive-foreground">{error}</p> : null}
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={submitting} onClick={props.onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canCreate}>
              {submitting
                ? "Creating…"
                : confirmedExisting !== null && confirmedExisting === targetPath
                  ? "Use existing folder"
                  : startNow
                    ? "Create and start"
                    : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
