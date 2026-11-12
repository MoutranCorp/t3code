import { useAtomValue } from "@effect/atom-react";
import { canCreateProjectInEnvironment } from "@t3tools/client-runtime/operations/projects";
import {
  ensureBrowseDirectoryPath,
  getBrowseParentPath,
} from "@t3tools/client-runtime/state/projects";
import { AuthOrchestrationOperateScope, type EnvironmentId } from "@t3tools/contracts";
import { resolvePastedPath } from "@t3tools/shared/path";
import { ArrowUpIcon, FolderIcon } from "lucide-react";

import { isElectron } from "../../env";
import { readLocalApi } from "../../localApi";
import { clientHostEnvironmentAtom } from "../../state/clientHostEnvironment";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { filesystemEnvironment, useFilesystemReadAccess } from "../../state/filesystem";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentsWithScope } from "../../state/session";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

/** Connected environments that can add projects, the primary one first. */
export function useNewProjectEnvironments() {
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const connected = environments.filter((environment) =>
    canCreateProjectInEnvironment(environment.connection.phase),
  );
  const operable = useEnvironmentsWithScope(connected, AuthOrchestrationOperateScope);
  return connected
    .filter((environment) => operable.has(environment.environmentId))
    .toSorted(
      (left, right) =>
        Number(right.environmentId === primaryEnvironmentId) -
        Number(left.environmentId === primaryEnvironmentId),
    )
    .map((environment) => ({
      environmentId: environment.environmentId,
      label: environment.label,
      isPrimary: environment.environmentId === primaryEnvironmentId,
      os: environment.serverConfig?.environment.platform.os ?? null,
      settings: environment.serverConfig?.settings ?? null,
      newProjectsRoot: environment.serverConfig?.newProjectsRoot ?? null,
    }));
}

type NewProjectEnvironment = ReturnType<typeof useNewProjectEnvironments>[number];

/** Picks the machine, shown only when there is more than one to pick from. */
export function NewProjectEnvironmentSelect(props: {
  readonly environments: readonly NewProjectEnvironment[];
  readonly value: EnvironmentId | null;
  readonly onValueChange: (environmentId: EnvironmentId) => void;
}) {
  if (props.environments.length < 2) return null;
  return (
    <Select
      value={props.value}
      onValueChange={(value) => {
        if (value) props.onValueChange(value);
      }}
      items={props.environments.map((environment) => ({
        value: environment.environmentId,
        label: environment.label,
      }))}
    >
      <SelectTrigger size="sm" aria-label="Machine">
        <SelectValue />
      </SelectTrigger>
      <SelectPopup>
        {props.environments.map((environment) => (
          <SelectItem key={environment.environmentId} value={environment.environmentId}>
            {environment.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

/**
 * A folder path on the environment's host with its subfolders listed below. Listing goes
 * through the server, so it works for remote machines; this machine also gets the native picker.
 */
export function FolderBrowser(props: {
  readonly id: string;
  readonly environment: NewProjectEnvironment;
  readonly path: string;
  readonly onPathChange: (path: string) => void;
}) {
  const { environmentId } = props.environment;
  const access = useFilesystemReadAccess(environmentId);
  const isClientHost = useAtomValue(clientHostEnvironmentAtom(environmentId));
  const trimmed = props.path.trim();
  const directory = trimmed.length > 0 ? ensureBrowseDirectoryPath(trimmed) : null;
  const browse = useEnvironmentQuery(
    access.canReadFiles && directory !== null
      ? filesystemEnvironment.browse({ environmentId, input: { partialPath: directory } })
      : null,
  );
  const entries = (browse.data?.entries ?? []).filter((entry) => !entry.name.startsWith("."));
  const parent = directory === null ? null : getBrowseParentPath(directory);
  // A WSL host is Linux behind a Windows picker, whose paths it could not use.
  const canPickNatively =
    isElectron &&
    isClientHost &&
    props.environment.isPrimary &&
    props.environment.os !== "linux" &&
    props.environment.os !== null;

  const pickNatively = async () => {
    const picked = await readLocalApi()
      ?.dialogs.pickFolder({ initialPath: directory })
      .catch(() => null);
    if (picked) props.onPathChange(ensureBrowseDirectoryPath(picked));
  };

  const status = !access.canReadFiles
    ? access.isPending
      ? "Connecting…"
      : (access.error ?? "This connection cannot browse folders.")
    : directory === null
      ? "Type a folder path."
      : browse.error
        ? "That folder could not be read."
        : browse.data === null
          ? "Loading…"
          : entries.length === 0
            ? "No folders here."
            : null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <Input
          id={props.id}
          value={props.path}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) =>
            props.onPathChange(resolvePastedPath(props.path, event.target.value))
          }
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Up one folder"
          disabled={parent === null}
          onClick={() => {
            if (parent !== null) props.onPathChange(parent);
          }}
        >
          <ArrowUpIcon aria-hidden />
        </Button>
        {canPickNatively ? (
          <Button type="button" variant="outline" onClick={() => void pickNatively()}>
            Choose…
          </Button>
        ) : null}
      </div>
      <div className="h-40 overflow-y-auto rounded-md border">
        {status === null ? (
          entries.map((entry) => (
            <button
              key={entry.fullPath}
              type="button"
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-start text-sm not-last:border-b hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              onClick={() => props.onPathChange(ensureBrowseDirectoryPath(entry.fullPath))}
            >
              <FolderIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{entry.name}</span>
            </button>
          ))
        ) : (
          <p className="px-2.5 py-2 text-xs text-muted-foreground">{status}</p>
        )}
      </div>
    </div>
  );
}
