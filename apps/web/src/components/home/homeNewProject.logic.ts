import { findProjectByPath, getBrowseParentPath } from "@t3tools/client-runtime/state/projects";
import type { FilesystemBrowseEntry, FilesystemEntryMetadata } from "@t3tools/contracts";

import { joinHostPath } from "../files/filePath";

/** Files or folders whose presence marks a folder as a project worth importing. */
const PROJECT_MARKERS = [
  ".git",
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "Gemfile",
  "composer.json",
  "deno.json",
  "Package.swift",
  "pubspec.yaml",
  "CMakeLists.txt",
  "mix.exs",
] as const;

export interface ImportMarkerRequest {
  readonly folderPath: string;
  readonly path: string;
}

export function importMarkerRequests(
  folders: ReadonlyArray<Pick<FilesystemBrowseEntry, "fullPath">>,
): ImportMarkerRequest[] {
  return folders.flatMap((folder) =>
    PROJECT_MARKERS.map((marker) => ({
      folderPath: folder.fullPath,
      path: joinHostPath(folder.fullPath, marker),
    })),
  );
}

/** Folders with any marker present. `metadata` answers `requests` in order; null is missing. */
export function foldersThatLookLikeProjects(
  requests: readonly ImportMarkerRequest[],
  metadata: ReadonlyArray<FilesystemEntryMetadata | null>,
): Set<string> {
  const found = new Set<string>();
  for (const [index, request] of requests.entries()) {
    if (metadata[index] != null) found.add(request.folderPath);
  }
  return found;
}

export interface ImportCandidate {
  readonly name: string;
  readonly path: string;
  readonly looksLikeProject: boolean;
  readonly alreadyAdded: boolean;
}

/** Subfolders to offer: hidden ones are left out, likely projects come pre-checked. */
export function buildImportCandidates(input: {
  readonly entries: readonly FilesystemBrowseEntry[];
  readonly projectFolders: ReadonlySet<string>;
  readonly existingWorkspaceRoots: readonly string[];
}): ImportCandidate[] {
  const existing = input.existingWorkspaceRoots.map((workspaceRoot) => ({ workspaceRoot }));
  return input.entries
    .filter((entry) => !entry.name.startsWith(".") && entry.name !== "node_modules")
    .map((entry) => ({
      name: entry.name,
      path: entry.fullPath,
      looksLikeProject: input.projectFolders.has(entry.fullPath),
      alreadyAdded: findProjectByPath(existing, entry.fullPath) !== undefined,
    }));
}

export function defaultImportSelection(candidates: readonly ImportCandidate[]): Set<string> {
  return new Set(
    candidates
      .filter((candidate) => candidate.looksLikeProject && !candidate.alreadyAdded)
      .map((candidate) => candidate.path),
  );
}

const NAME_FILLER_WORDS = new Set(
  (
    "a an the i im i'm we want wanna would like to build make create write code need please " +
    "that which who with for of and or in on at my our me us is it its be can could you should " +
    "will let lets let's some simple small little new quick basic just using use called named"
  ).split(" "),
);

/** A short folder-safe name from a description, like `recipe-planner` for "A recipe planner…". */
export function suggestProjectName(description: string): string {
  const words = description
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .map((word) => word.replace(/'/g, ""))
    .filter((word) => word.length > 0 && !NAME_FILLER_WORDS.has(word));
  return words.slice(0, 3).join("-").slice(0, 40).replace(/-+$/, "");
}

/** A name that is one folder, not a path. */
export function isValidProjectFolderName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed !== "." && trimmed !== ".." && !/[\\/:*?"<>|]/.test(trimmed);
}

/** Where the latest project lives; new projects usually go next to it. */
export function latestProjectParent(
  projects: ReadonlyArray<{
    readonly workspaceRoot: string;
    readonly createdAt: string;
    readonly isScratch?: true;
  }>,
): string | null {
  const latest = projects
    .filter((project) => !project.isScratch)
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  return latest ? getBrowseParentPath(latest.workspaceRoot) : null;
}
