import type { HomeFolder } from "../../uiStateStore";
import type { HomeProject, HomeProjectBadges } from "./homeScreen.logic";

type FolderProject = Pick<HomeProject, "projectKey" | "memberProjects">;

/** Folders store every checkout's key, like `projectOrder`, so regrouping keeps membership. */
export function homeFolderMemberKeys(project: Pick<HomeProject, "memberProjects">): string[] {
  return project.memberProjects.map((member) => member.physicalProjectKey);
}

export function removeFromHomeFolders(
  folders: readonly HomeFolder[],
  keys: readonly string[],
): HomeFolder[] {
  const drop = new Set(keys);
  return folders.map((folder) =>
    folder.memberKeys.some((key) => drop.has(key))
      ? { ...folder, memberKeys: folder.memberKeys.filter((key) => !drop.has(key)) }
      : folder,
  );
}

/** A project lives in one folder at most, so its keys leave any other folder first. */
export function createHomeFolder(folders: readonly HomeFolder[], folder: HomeFolder): HomeFolder[] {
  return [...removeFromHomeFolders(folders, folder.memberKeys), folder];
}

export function addToHomeFolder(
  folders: readonly HomeFolder[],
  folderId: string,
  keys: readonly string[],
): HomeFolder[] {
  return removeFromHomeFolders(folders, keys).map((folder) =>
    folder.id === folderId ? { ...folder, memberKeys: [...folder.memberKeys, ...keys] } : folder,
  );
}

export function renameHomeFolder(
  folders: readonly HomeFolder[],
  folderId: string,
  name: string,
): HomeFolder[] {
  const trimmed = name.trim();
  return folders.map((folder) =>
    folder.id === folderId && trimmed.length > 0 ? { ...folder, name: trimmed } : folder,
  );
}

export function ungroupHomeFolder(folders: readonly HomeFolder[], folderId: string): HomeFolder[] {
  return folders.filter((folder) => folder.id !== folderId);
}

export function nextHomeFolderName(folders: readonly HomeFolder[]): string {
  const names = new Set(folders.map((folder) => folder.name));
  if (!names.has("Folder")) return "Folder";
  let index = 2;
  while (names.has(`Folder ${index}`)) index++;
  return `Folder ${index}`;
}

export interface ResolvedHomeFolder<T> {
  readonly folder: HomeFolder;
  readonly projects: readonly T[];
}

/**
 * Folders as Home shows them, members in folder order. A folder needs two present
 * members to show; keys of absent projects stay so an offline machine's projects return.
 */
export function resolveHomeFolders<T extends FolderProject>(
  folders: readonly HomeFolder[],
  projects: readonly T[],
): ResolvedHomeFolder<T>[] {
  const claimed = new Set<string>();
  const resolved: ResolvedHomeFolder<T>[] = [];
  for (const folder of folders) {
    const rank = new Map<string, number>();
    for (const [index, key] of folder.memberKeys.entries()) {
      if (!rank.has(key)) rank.set(key, index);
    }
    const members = projects
      .filter((project) => !claimed.has(project.projectKey))
      .map((project) => ({
        project,
        rank: Math.min(
          ...homeFolderMemberKeys(project).map((key) => rank.get(key) ?? Number.POSITIVE_INFINITY),
        ),
      }))
      .filter(({ rank }) => Number.isFinite(rank))
      .toSorted((left, right) => left.rank - right.rank)
      .map(({ project }) => project);
    if (members.length < 2) continue;
    for (const member of members) claimed.add(member.projectKey);
    resolved.push({ folder, projects: members });
  }
  return resolved;
}

/** Drops folders left with fewer than two present members, which dissolves them. */
export function pruneHomeFolders(
  folders: readonly HomeFolder[],
  projects: readonly FolderProject[],
): HomeFolder[] {
  const shown = new Set(resolveHomeFolders(folders, projects).map(({ folder }) => folder.id));
  return folders.filter((folder) => shown.has(folder.id));
}

export type HomeEntry<T> =
  | { readonly kind: "project"; readonly key: string; readonly project: T }
  | {
      readonly kind: "folder";
      readonly key: string;
      readonly folder: HomeFolder;
      readonly projects: readonly T[];
    };

export const homeFolderEntryKey = (folderId: string) => `home-folder:${folderId}`;

/** Grid entries in home order. A folder sits where its first member would. */
export function buildHomeEntries<T extends FolderProject>(
  orderedProjects: readonly T[],
  folders: readonly ResolvedHomeFolder<T>[],
): HomeEntry<T>[] {
  const folderByProjectKey = new Map<string, ResolvedHomeFolder<T>>();
  for (const resolved of folders) {
    for (const project of resolved.projects) folderByProjectKey.set(project.projectKey, resolved);
  }
  const placed = new Set<string>();
  return orderedProjects.flatMap((project): HomeEntry<T>[] => {
    const resolved = folderByProjectKey.get(project.projectKey);
    if (!resolved) return [{ kind: "project", key: project.projectKey, project }];
    if (placed.has(resolved.folder.id)) return [];
    placed.add(resolved.folder.id);
    return [
      {
        kind: "folder",
        key: homeFolderEntryKey(resolved.folder.id),
        folder: resolved.folder,
        projects: resolved.projects,
      },
    ];
  });
}

/** Entries shaped for `planHomeReorder`: a folder moves all its members together. */
export function homeEntryReorderItems<T extends FolderProject>(entries: readonly HomeEntry<T>[]) {
  return entries.map((entry) => ({
    projectKey: entry.key,
    memberProjects:
      entry.kind === "project"
        ? entry.project.memberProjects
        : entry.projects.flatMap((project) => project.memberProjects),
  }));
}

/** Dropping with the dragged tile's centre over the middle of another tile groups them. */
export function isHomeGroupingDrop(
  point: { readonly x: number; readonly y: number },
  rect: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  },
): boolean {
  return (
    point.x > rect.left + rect.width * 0.25 &&
    point.x < rect.left + rect.width * 0.75 &&
    point.y > rect.top + rect.height * 0.15 &&
    point.y < rect.top + rect.height * 0.65
  );
}

export function sumHomeBadges(badges: readonly HomeProjectBadges[]): HomeProjectBadges {
  return {
    attention: badges.reduce((total, entry) => total + entry.attention, 0),
    working: badges.some((entry) => entry.working),
    appRunning: badges.some((entry) => entry.appRunning),
  };
}
