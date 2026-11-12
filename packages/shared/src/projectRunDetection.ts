import type { ProjectScriptIcon } from "@t3tools/contracts";

import { parseT3ProjectFile } from "./t3ProjectFile.ts";

// Bun writes no root-level marker for hoisted installs, so bun projects always look uninstalled.
const NODE_INSTALL_MARKER_FILES = [
  "node_modules/.package-lock.json",
  "node_modules/.modules.yaml",
  "node_modules/.yarn-integrity",
  "node_modules/.yarn-state.yml",
  ".pnp.cjs",
];

const COMPOSE_FILES = ["compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"];

/** Workspace-relative files the caller should try to read before calling detectRunTargets. */
export const RUN_DETECTION_FILES: ReadonlyArray<string> = [
  "t3.json",
  "package.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  ...NODE_INSTALL_MARKER_FILES,
  "Cargo.toml",
  "go.mod",
  "manage.py",
  "pyproject.toml",
  "main.py",
  "app.py",
  "uv.lock",
  "pytest.ini",
  ...COMPOSE_FILES,
  "Makefile",
  "index.html",
];

export interface DetectedRunTarget {
  readonly name: string;
  readonly command: string;
  readonly icon: ProjectScriptIcon;
}

export interface RunDetection {
  /** Targets in priority order. The first target with icon "play" is the default Run target. */
  readonly targets: ReadonlyArray<DetectedRunTarget>;
  /** Dependency install command to run first when dependencies look missing; otherwise null. */
  readonly installCommand: string | null;
}

type DetectionFiles = Readonly<Record<string, string | null>>;
type PackageJson = Record<string, unknown>;

const PACKAGE_MANAGERS = ["npm", "pnpm", "yarn", "bun"] as const;
type PackageManager = (typeof PACKAGE_MANAGERS)[number];

const NODE_RUN_SCRIPTS = ["dev", "start", "serve", "preview"];
const MAKE_RUN_RULES = ["dev", "run", "start"];

const target = (name: string, command: string, icon: ProjectScriptIcon): DetectedRunTarget => ({
  name,
  command,
  icon,
});

const exists = (files: DetectionFiles, path: string) => files[path] != null;

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePackageJson(contents: string | null | undefined): PackageJson | null {
  if (contents == null) return null;
  try {
    const parsed: unknown = JSON.parse(contents.replace(/^\uFEFF/, ""));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function detectPackageManager(files: DetectionFiles, pkg: PackageJson): PackageManager {
  const declared = typeof pkg.packageManager === "string" ? pkg.packageManager.split("@")[0] : "";
  const fromField = PACKAGE_MANAGERS.find((pm) => pm === declared);
  if (fromField) return fromField;
  if (exists(files, "pnpm-lock.yaml")) return "pnpm";
  if (exists(files, "yarn.lock")) return "yarn";
  if (exists(files, "bun.lock") || exists(files, "bun.lockb")) return "bun";
  return "npm";
}

function detectNodeTargets(pkg: PackageJson, pm: PackageManager): DetectedRunTarget[] {
  const scripts = isRecord(pkg.scripts) ? pkg.scripts : {};
  const script = (name: string) => {
    const command = scripts[name];
    return typeof command === "string" && command.trim() !== "" ? command : null;
  };
  const targets: DetectedRunTarget[] = [];
  const runScript = NODE_RUN_SCRIPTS.find((name) => script(name) !== null);
  if (runScript) {
    const name = runScript === "dev" ? "Dev" : capitalize(runScript);
    targets.push(target(name, `${pm} run ${runScript}`, "play"));
  }
  const test = script("test");
  // npm init's placeholder: echo "Error: no test specified" && exit 1
  if (test !== null && !test.includes("no test specified")) {
    targets.push(target("Test", `${pm} run test`, "test"));
  }
  if (script("build") !== null) targets.push(target("Build", `${pm} run build`, "build"));
  if (script("lint") !== null) targets.push(target("Lint", `${pm} run lint`, "lint"));
  return targets;
}

function hasNodeDependencies(pkg: PackageJson): boolean {
  return [pkg.dependencies, pkg.devDependencies].some(
    (deps) => isRecord(deps) && Object.keys(deps).length > 0,
  );
}

function detectPythonTargets(files: DetectionFiles): DetectedRunTarget[] {
  const usesUv = exists(files, "uv.lock");
  const python = usesUv ? "uv run" : "python";
  const entry = ["main.py", "app.py"].find((path) => exists(files, path));
  const targets: DetectedRunTarget[] = [];
  if (exists(files, "manage.py")) {
    targets.push(target("Dev", `${python} manage.py runserver`, "play"));
  } else if (entry) {
    targets.push(target("Run", `${python} ${entry}`, "play"));
  }
  if (exists(files, "pytest.ini") || files["pyproject.toml"]?.includes("pytest")) {
    targets.push(target("Test", usesUv ? "uv run pytest" : "pytest", "test"));
  }
  return targets;
}

function detectFallbackRunTarget(files: DetectionFiles): DetectedRunTarget | null {
  if (COMPOSE_FILES.some((path) => exists(files, path))) {
    return target("Up", "docker compose up", "play");
  }
  const makefile = files["Makefile"];
  const makeRule =
    makefile == null
      ? undefined
      : MAKE_RUN_RULES.find((rule) => new RegExp(`^${rule}\\s*::?(?!=)`, "m").test(makefile));
  if (makeRule) return target(capitalize(makeRule), `make ${makeRule}`, "play");
  if (exists(files, "index.html")) return target("Serve", "npx --yes serve .", "play");
  return null;
}

/**
 * `files` maps a workspace-relative path to its text content. A path that is absent or maps to
 * null means the file does not exist (or could not be read). Callers pass only paths from
 * RUN_DETECTION_FILES.
 */
export function detectRunTargets(files: DetectionFiles): RunDetection {
  const pkg = parsePackageJson(files["package.json"]);
  const pm = pkg ? detectPackageManager(files, pkg) : null;
  const installCommand =
    pkg &&
    hasNodeDependencies(pkg) &&
    !NODE_INSTALL_MARKER_FILES.some((path) => exists(files, path))
      ? `${pm} install`
      : null;

  const t3Contents = files["t3.json"];
  const t3Targets = (t3Contents == null ? null : parseT3ProjectFile(t3Contents))?.scripts?.map(
    (script) => target(script.name, script.command, script.icon ?? "play"),
  );
  if (t3Targets && t3Targets.length > 0) return { targets: t3Targets, installCommand };

  const ecosystems = [
    pkg && pm ? detectNodeTargets(pkg, pm) : [],
    exists(files, "Cargo.toml")
      ? [
          target("Run", "cargo run", "play"),
          target("Test", "cargo test", "test"),
          target("Build", "cargo build", "build"),
        ]
      : [],
    exists(files, "go.mod")
      ? [
          target("Run", "go run .", "play"),
          target("Test", "go test ./...", "test"),
          target("Build", "go build ./...", "build"),
        ]
      : [],
    detectPythonTargets(files),
  ];
  const targets = ecosystems.find((candidate) => candidate.length > 0) ?? [];
  if (targets.some((candidate) => candidate.icon === "play")) return { targets, installCommand };
  const fallback = detectFallbackRunTarget(files);
  return { targets: fallback ? [...targets, fallback] : targets, installCommand };
}
