import { describe, expect, it } from "vite-plus/test";

import type { HomeFolder } from "../../uiStateStore";
import {
  addToHomeFolder,
  buildHomeEntries,
  createHomeFolder,
  homeEntryReorderItems,
  homeFolderEntryKey,
  isHomeGroupingDrop,
  nextHomeFolderName,
  pruneHomeFolders,
  removeFromHomeFolders,
  renameHomeFolder,
  resolveHomeFolders,
  ungroupHomeFolder,
} from "./homeFolders.logic";
import { planHomeReorder } from "./homeScreen.logic";

function project(name: string, roots: readonly string[] = [`/work/${name}`]) {
  return {
    projectKey: `key:${name}`,
    displayName: name,
    memberProjects: roots.map((workspaceRoot) => ({
      physicalProjectKey: `local:${workspaceRoot}`,
      workspaceRoot,
      title: name,
      environmentLabel: null,
    })),
  };
}

const [alpha, beta, gamma, delta] = ["alpha", "beta", "gamma", "delta"].map((name) =>
  project(name),
) as [
  ReturnType<typeof project>,
  ReturnType<typeof project>,
  ReturnType<typeof project>,
  ReturnType<typeof project>,
];
const keyOf = (name: string) => `local:/work/${name}`;
const folder = (id: string, names: readonly string[], name = "Folder"): HomeFolder => ({
  id,
  name,
  memberKeys: names.map(keyOf),
});

describe("home folder reducers", () => {
  it("moves a project out of its old folder when it joins another", () => {
    const folders = [folder("one", ["alpha", "beta", "gamma"])];
    const created = createHomeFolder(folders, folder("two", ["gamma", "delta"]));
    expect(created).toEqual([folder("one", ["alpha", "beta"]), folder("two", ["gamma", "delta"])]);
    expect(addToHomeFolder(created, "one", [keyOf("delta")])).toEqual([
      folder("one", ["alpha", "beta", "delta"]),
      folder("two", ["gamma"]),
    ]);
  });

  it("dissolves a folder left with one present member", () => {
    const folders = removeFromHomeFolders(
      [folder("one", ["alpha", "beta"]), folder("two", ["gamma", "delta"])],
      [keyOf("alpha")],
    );
    expect(pruneHomeFolders(folders, [alpha, beta, gamma, delta])).toEqual([
      folder("two", ["gamma", "delta"]),
    ]);
  });

  it("prunes folders whose projects are gone but keeps absent keys in folders that still show", () => {
    const folders = [folder("one", ["alpha", "beta", "gone"]), folder("two", ["gamma", "gone2"])];
    expect(pruneHomeFolders(folders, [alpha, beta, gamma])).toEqual([
      folder("one", ["alpha", "beta", "gone"]),
    ]);
  });

  it("renames with a trimmed name, ignores a blank one, and ungroups", () => {
    const folders = [folder("one", ["alpha", "beta"])];
    expect(renameHomeFolder(folders, "one", "  Tools ")[0]?.name).toBe("Tools");
    expect(renameHomeFolder(folders, "one", "   ")[0]?.name).toBe("Folder");
    expect(ungroupHomeFolder(folders, "one")).toEqual([]);
  });

  it("names new folders without repeating a name", () => {
    expect(nextHomeFolderName([])).toBe("Folder");
    expect(nextHomeFolderName([folder("a", [], "Folder"), folder("b", [], "Folder 2")])).toBe(
      "Folder 3",
    );
  });
});

describe("resolveHomeFolders", () => {
  it("orders members by folder order and matches any checkout of a grouped project", () => {
    const grouped = project("grouped", ["/work/grouped", "/remote/grouped"]);
    const resolved = resolveHomeFolders(
      [{ id: "one", name: "Folder", memberKeys: ["local:/remote/grouped", keyOf("alpha")] }],
      [alpha, grouped],
    );
    expect(resolved.map(({ projects }) => projects.map((entry) => entry.displayName))).toEqual([
      ["grouped", "alpha"],
    ]);
  });
});

describe("buildHomeEntries", () => {
  it("places a folder at its first member's slot and reorders it as one block", () => {
    const ordered = [alpha, beta, gamma, delta];
    const entries = buildHomeEntries(
      ordered,
      resolveHomeFolders([folder("one", ["delta", "beta"])], ordered),
    );
    expect(entries.map((entry) => entry.key)).toEqual([
      "key:alpha",
      homeFolderEntryKey("one"),
      "key:gamma",
    ]);

    const plan = planHomeReorder(
      homeEntryReorderItems(entries),
      [],
      homeFolderEntryKey("one"),
      "key:gamma",
    );
    expect(plan?.dragged).toEqual([keyOf("delta"), keyOf("beta")]);
    expect(plan?.target).toEqual([keyOf("gamma")]);
  });
});

describe("isHomeGroupingDrop", () => {
  const rect = { left: 0, top: 0, width: 100, height: 140 };
  it("groups only over the middle of the icon", () => {
    expect(isHomeGroupingDrop({ x: 50, y: 50 }, rect)).toBe(true);
    expect(isHomeGroupingDrop({ x: 10, y: 50 }, rect)).toBe(false);
    expect(isHomeGroupingDrop({ x: 50, y: 120 }, rect)).toBe(false);
  });
});
