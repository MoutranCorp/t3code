import { describe, expect, it } from "vite-plus/test";

import { detectRunTargets, RUN_DETECTION_FILES } from "./projectRunDetection.ts";

const packageJson = (value: Record<string, unknown>) => JSON.stringify(value);

const installedNodeApp = {
  "package.json": packageJson({
    scripts: {
      dev: "vite",
      start: "node server.js",
      test: "vitest",
      build: "vite build",
      lint: "eslint .",
    },
    dependencies: { react: "^19.0.0" },
  }),
  "node_modules/.package-lock.json": "{}",
};

describe("detectRunTargets", () => {
  it("returns nothing for an empty project", () => {
    expect(detectRunTargets({})).toEqual({ targets: [], installCommand: null });
  });

  it("uses t3.json scripts ahead of ecosystem rules", () => {
    const detection = detectRunTargets({
      ...installedNodeApp,
      "Cargo.toml": "[package]",
      "t3.json": JSON.stringify({
        scripts: [
          { name: "Setup", command: "node setup.ts", icon: "configure" },
          { name: "App", command: "vp run dev" },
        ],
      }),
    });

    expect(detection.targets).toEqual([
      { name: "Setup", command: "node setup.ts", icon: "configure" },
      { name: "App", command: "vp run dev", icon: "play" },
    ]);
  });

  it("still computes the install command when t3.json wins", () => {
    const detection = detectRunTargets({
      "t3.json": JSON.stringify({ scripts: [{ name: "Dev", command: "pnpm dev" }] }),
      "package.json": packageJson({ devDependencies: { vite: "^7.0.0" } }),
      "pnpm-lock.yaml": "lockfileVersion: '9.0'",
    });

    expect(detection.installCommand).toBe("pnpm install");
  });

  it("falls back to ecosystem rules when t3.json has no scripts", () => {
    const detection = detectRunTargets({
      "t3.json": JSON.stringify({ defaultThreadEnvMode: "worktree" }),
      "go.mod": "module example.com/app",
    });

    expect(detection.targets[0]).toEqual({ name: "Run", command: "go run .", icon: "play" });
  });

  it("maps Node scripts to targets in priority order", () => {
    expect(detectRunTargets(installedNodeApp)).toEqual({
      targets: [
        { name: "Dev", command: "npm run dev", icon: "play" },
        { name: "Test", command: "npm run test", icon: "test" },
        { name: "Build", command: "npm run build", icon: "build" },
        { name: "Lint", command: "npm run lint", icon: "lint" },
      ],
      installCommand: null,
    });
  });

  it("uses the first available run script and skips npm's placeholder test", () => {
    const detection = detectRunTargets({
      "package.json": packageJson({
        scripts: {
          preview: "vite preview",
          serve: "serve dist",
          test: 'echo "Error: no test specified" && exit 1',
        },
      }),
    });

    expect(detection.targets).toEqual([{ name: "Serve", command: "npm run serve", icon: "play" }]);
  });

  it.each([
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
  ])("selects the package manager from %s", (lockfile, pm) => {
    const detection = detectRunTargets({
      "package.json": packageJson({ scripts: { start: "node ." } }),
      [lockfile]: "",
    });

    expect(detection.targets[0]?.command).toBe(`${pm} run start`);
  });

  it("prefers the packageManager field over lockfiles", () => {
    const detection = detectRunTargets({
      "package.json": packageJson({
        packageManager: "yarn@4.5.0+sha512.abc",
        scripts: { dev: "vite" },
      }),
      "pnpm-lock.yaml": "",
    });

    expect(detection.targets[0]?.command).toBe("yarn run dev");
  });

  it("suggests installing when dependencies are declared but not installed", () => {
    expect(
      detectRunTargets({ "package.json": installedNodeApp["package.json"] }).installCommand,
    ).toBe("npm install");
  });

  it.each([
    "node_modules/.package-lock.json",
    "node_modules/.modules.yaml",
    "node_modules/.yarn-integrity",
    "node_modules/.yarn-state.yml",
    ".pnp.cjs",
  ])("treats %s as installed dependencies", (marker) => {
    expect(
      detectRunTargets({ "package.json": installedNodeApp["package.json"], [marker]: "" })
        .installCommand,
    ).toBeNull();
  });

  it("does not suggest installing when nothing is declared", () => {
    expect(
      detectRunTargets({ "package.json": packageJson({ scripts: { dev: "node ." } }) })
        .installCommand,
    ).toBeNull();
  });

  it("lets Node win over Cargo in mixed repos without merging targets", () => {
    const detection = detectRunTargets({ ...installedNodeApp, "Cargo.toml": "[package]" });

    expect(detection.targets.some((target) => target.command.startsWith("cargo"))).toBe(false);
  });

  it("detects Rust projects", () => {
    expect(detectRunTargets({ "Cargo.toml": "[package]" }).targets).toEqual([
      { name: "Run", command: "cargo run", icon: "play" },
      { name: "Test", command: "cargo test", icon: "test" },
      { name: "Build", command: "cargo build", icon: "build" },
    ]);
  });

  it("detects Go projects", () => {
    expect(detectRunTargets({ "go.mod": "module example.com/app" }).targets).toEqual([
      { name: "Run", command: "go run .", icon: "play" },
      { name: "Test", command: "go test ./...", icon: "test" },
      { name: "Build", command: "go build ./...", icon: "build" },
    ]);
  });

  it("detects Django projects", () => {
    expect(detectRunTargets({ "manage.py": "", "pytest.ini": "" }).targets).toEqual([
      { name: "Dev", command: "python manage.py runserver", icon: "play" },
      { name: "Test", command: "pytest", icon: "test" },
    ]);
  });

  it("runs Python entry files through uv when uv.lock exists", () => {
    expect(
      detectRunTargets({
        "app.py": "",
        "uv.lock": "",
        "pyproject.toml": '[dependency-groups]\ndev = ["pytest>=8"]',
      }).targets,
    ).toEqual([
      { name: "Run", command: "uv run app.py", icon: "play" },
      { name: "Test", command: "uv run pytest", icon: "test" },
    ]);
  });

  it("detects a plain Python entry file", () => {
    expect(detectRunTargets({ "main.py": "", "app.py": "" }).targets).toEqual([
      { name: "Run", command: "python main.py", icon: "play" },
    ]);
  });

  it("uses docker compose only when no ecosystem provides a run target", () => {
    expect(detectRunTargets({ "compose.yaml": "services: {}" }).targets).toEqual([
      { name: "Up", command: "docker compose up", icon: "play" },
    ]);
    expect(
      detectRunTargets({ "docker-compose.yml": "", "go.mod": "module x" }).targets[0]?.command,
    ).toBe("go run .");
  });

  it("adds a fallback run target after ecosystem targets that lack one", () => {
    expect(
      detectRunTargets({
        "package.json": packageJson({ scripts: { build: "tsc" } }),
        Makefile: "start:\n\tnode dist/index.js\n",
      }).targets,
    ).toEqual([
      { name: "Build", command: "npm run build", icon: "build" },
      { name: "Start", command: "make start", icon: "play" },
    ]);
  });

  it("only uses Makefile rules named dev, run or start", () => {
    expect(detectRunTargets({ Makefile: "run := 1\nbuild:\n\tcc main.c\n" }).targets).toEqual([]);
    expect(detectRunTargets({ Makefile: "run: build\n\t./app\ndev:\n\t./dev\n" }).targets).toEqual([
      { name: "Dev", command: "make dev", icon: "play" },
    ]);
  });

  it("serves a static site with index.html", () => {
    expect(detectRunTargets({ "index.html": "<!doctype html>" }).targets).toEqual([
      { name: "Serve", command: "npx --yes serve .", icon: "play" },
    ]);
  });

  it("ignores malformed project files without throwing", () => {
    expect(
      detectRunTargets({
        "t3.json": "{ not json",
        "package.json": '{"scripts": ["dev"], "dependencies": "react"',
      }),
    ).toEqual({ targets: [], installCommand: null });
    expect(
      detectRunTargets({
        "package.json": packageJson({ scripts: { dev: 42 }, dependencies: ["react"] }),
        "index.html": "",
      }),
    ).toEqual({
      targets: [{ name: "Serve", command: "npx --yes serve .", icon: "play" }],
      installCommand: null,
    });
  });

  it("only reads paths listed in RUN_DETECTION_FILES", () => {
    const read = new Set<string>();
    const tracked = (files: Record<string, string>) =>
      new Proxy(files, {
        get: (target, key) => {
          if (typeof key === "string") read.add(key);
          return Reflect.get(target, key);
        },
      });
    const everything = Object.fromEntries(RUN_DETECTION_FILES.map((path) => [path, ""]));

    detectRunTargets(tracked({}));
    detectRunTargets(tracked(everything));
    detectRunTargets(tracked({ ...installedNodeApp, "t3.json": "{}" }));
    detectRunTargets(tracked({ "pyproject.toml": "pytest", Makefile: "dev:\n" }));

    expect([...read].filter((path) => !RUN_DETECTION_FILES.includes(path))).toEqual([]);
  });
});
