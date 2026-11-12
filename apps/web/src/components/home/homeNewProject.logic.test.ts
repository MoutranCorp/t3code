import { describe, expect, it } from "vite-plus/test";

import {
  buildImportCandidates,
  defaultImportSelection,
  foldersThatLookLikeProjects,
  importMarkerRequests,
  isValidProjectFolderName,
  latestProjectParent,
  suggestProjectName,
} from "./homeNewProject.logic";

describe("import classification", () => {
  it("pre-checks folders with a project marker and greys out ones already added", () => {
    const entries = [
      { name: "api", fullPath: "/code/api" },
      { name: "notes", fullPath: "/code/notes" },
      { name: "web", fullPath: "/code/web" },
      { name: ".cache", fullPath: "/code/.cache" },
      { name: "node_modules", fullPath: "/code/node_modules" },
    ];
    const requests = importMarkerRequests(entries.slice(0, 3));
    expect(requests).toContainEqual({ folderPath: "/code/api", path: "/code/api/Cargo.toml" });
    const metadata = requests.map((request) =>
      request.path === "/code/api/Cargo.toml" || request.path === "/code/web/.git"
        ? { kind: "file" as const }
        : null,
    );
    const candidates = buildImportCandidates({
      entries,
      projectFolders: foldersThatLookLikeProjects(requests, metadata),
      existingWorkspaceRoots: ["/code/web/"],
    });
    expect(candidates).toEqual([
      { name: "api", path: "/code/api", looksLikeProject: true, alreadyAdded: false },
      { name: "notes", path: "/code/notes", looksLikeProject: false, alreadyAdded: false },
      { name: "web", path: "/code/web", looksLikeProject: true, alreadyAdded: true },
    ]);
    expect([...defaultImportSelection(candidates)]).toEqual(["/code/api"]);
  });

  it("joins markers with the host's separator", () => {
    expect(importMarkerRequests([{ fullPath: "C:\\code\\api" }])[1]?.path).toBe(
      "C:\\code\\api\\package.json",
    );
  });
});

describe("suggestProjectName", () => {
  it("keeps the first meaningful words as a slug", () => {
    expect(suggestProjectName("I want to build a recipe planner that syncs with my calendar")).toBe(
      "recipe-planner-syncs",
    );
    expect(suggestProjectName("Café menu app")).toBe("cafe-menu-app");
    expect(suggestProjectName("a the to")).toBe("");
  });
});

describe("isValidProjectFolderName", () => {
  it("accepts a single folder name only", () => {
    expect(isValidProjectFolderName("recipe-planner")).toBe(true);
    expect(isValidProjectFolderName("a/b")).toBe(false);
    expect(isValidProjectFolderName("..")).toBe(false);
    expect(isValidProjectFolderName("  ")).toBe(false);
  });
});

describe("latestProjectParent", () => {
  it("uses the newest non-scratch project's parent folder", () => {
    expect(
      latestProjectParent([
        { workspaceRoot: "/old/one", createdAt: "2026-01-01T00:00:00.000Z" },
        { workspaceRoot: "/new/two", createdAt: "2026-03-01T00:00:00.000Z" },
        { workspaceRoot: "/scratch/x", createdAt: "2026-04-01T00:00:00.000Z", isScratch: true },
      ]),
    ).toBe("/new/");
    expect(latestProjectParent([])).toBeNull();
  });
});
