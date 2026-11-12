import { ThreadId, type DiscoveredLocalServer, type ProjectScript } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildDetectedProjectScripts,
  buildRunDetectionFiles,
  deriveProjectRunPhase,
  deriveProjectRunView,
  findRunServer,
  observeProjectRun,
  type ProjectRun,
  runAwaitsPreview,
  runDetectionDirectories,
  type RunTerminals,
  terminalOutputTail,
} from "./projectRunControl.logic";

const threadId = ThreadId.make("thread-1");

const run = (overrides: Partial<ProjectRun> = {}): ProjectRun => ({
  id: 1,
  scriptId: "dev",
  command: "pnpm dev",
  longRunning: true,
  terminalId: "terminal-2",
  sawTerminal: false,
  sawRunning: false,
  startGraceElapsed: false,
  previewOpened: false,
  ...overrides,
});

const terminals = (
  state: { status?: "running" | "exited"; hasRunningSubprocess: boolean } | null,
): RunTerminals =>
  new Map(
    state === null
      ? []
      : [["terminal-2", { ...state, status: state.status ?? "running" }] as const],
  );

const script = (id: string, overrides: Partial<ProjectScript> = {}): ProjectScript => ({
  id,
  name: id,
  command: `pnpm ${id}`,
  icon: "play",
  runOnWorktreeCreate: false,
  ...overrides,
});

/** Mirrors the control: each metadata update is folded into the remembered run. */
function phases(
  start: ProjectRun,
  updates: ReadonlyArray<RunTerminals>,
): ReadonlyArray<ReturnType<typeof deriveProjectRunPhase>> {
  let current = start;
  return updates.map((update) => {
    const phase = deriveProjectRunPhase(current, update);
    current = observeProjectRun(current, update);
    return phase;
  });
}

describe("deriveProjectRunPhase", () => {
  it("is idle without a run and starting while the terminal opens", () => {
    expect(deriveProjectRunPhase(undefined, terminals(null))).toBe("idle");
    expect(deriveProjectRunPhase(run({ terminalId: null }), terminals(null))).toBe("starting");
  });

  it("goes from starting to running to exited when the subprocess ends on its own", () => {
    expect(
      phases(run(), [
        terminals(null),
        terminals({ hasRunningSubprocess: false }),
        terminals({ hasRunningSubprocess: true }),
        terminals({ hasRunningSubprocess: false }),
      ]),
    ).toEqual(["starting", "starting", "running", "exited"]);
  });

  it("counts a command never seen running as exited once the start grace passes", () => {
    const listed = terminals({ hasRunningSubprocess: false });
    expect(deriveProjectRunPhase(run(), listed)).toBe("starting");
    expect(deriveProjectRunPhase(run({ startGraceElapsed: true }), listed)).toBe("exited");
  });

  it("recovers to running when the subprocess reappears after an install finishes", () => {
    let current = run();
    const seen: Array<[ReturnType<typeof deriveProjectRunPhase>, ProjectRun]> = [];
    for (const hasRunningSubprocess of [true, false, true]) {
      const update = terminals({ hasRunningSubprocess });
      seen.push([deriveProjectRunPhase(current, update), current]);
      current = observeProjectRun(current, update);
    }
    expect(seen.map(([phase]) => phase)).toEqual(["running", "exited", "running"]);
    expect(seen[2]?.[1]).toBe(seen[1]?.[1]);
    expect(current).toBe(seen[1]?.[1]);
  });

  it("returns a finished non-play run to idle instead of exited", () => {
    const build = run({ scriptId: "build", command: "pnpm build", longRunning: false });
    expect(
      phases(build, [
        terminals({ hasRunningSubprocess: true }),
        terminals({ hasRunningSubprocess: false }),
      ]),
    ).toEqual(["running", "idle"]);
    expect(
      deriveProjectRunPhase(
        { ...build, startGraceElapsed: true },
        terminals({ hasRunningSubprocess: false }),
      ),
    ).toBe("idle");
    expect(
      phases(run(), [
        terminals({ hasRunningSubprocess: true }),
        terminals({ hasRunningSubprocess: false }),
      ]),
    ).toEqual(["running", "exited"]);
  });

  it("treats an exited shell as an exited run", () => {
    expect(
      deriveProjectRunPhase(run(), terminals({ status: "exited", hasRunningSubprocess: false })),
    ).toBe("exited");
  });

  it("goes idle when a terminal it saw is closed", () => {
    expect(phases(run(), [terminals({ hasRunningSubprocess: true }), terminals(null)])).toEqual([
      "running",
      "idle",
    ]);
  });

  it("keeps the last known phase while terminal metadata is unavailable", () => {
    expect(deriveProjectRunPhase(run({ sawRunning: true }), null)).toBe("running");
    expect(deriveProjectRunPhase(run(), null)).toBe("starting");
  });
});

describe("observeProjectRun", () => {
  it("returns the same run when the terminal shows nothing new", () => {
    const seen = run({ sawTerminal: true, sawRunning: true });
    expect(observeProjectRun(seen, terminals({ hasRunningSubprocess: false }))).toBe(seen);
    expect(observeProjectRun(seen, null)).toBe(seen);
  });
});

describe("deriveProjectRunView", () => {
  it("follows the last invoked script, else the primary one", () => {
    const scripts = [
      script("setup", { runOnWorktreeCreate: true }),
      script("dev"),
      script("test", { icon: "test" }),
    ];
    const runs = { test: run({ scriptId: "test" }) };
    const base = { scripts, runs, terminals: terminals(null) };
    expect(deriveProjectRunView({ ...base, preferredScriptId: null })).toMatchObject({
      phase: "idle",
      script: { id: "dev" },
      run: null,
    });
    expect(deriveProjectRunView({ ...base, preferredScriptId: "test" })).toMatchObject({
      phase: "starting",
      script: { id: "test" },
      run: { scriptId: "test" },
    });
  });

  it("shows a freshly detected run before its saved script arrives", () => {
    expect(
      deriveProjectRunView({
        scripts: [],
        preferredScriptId: "dev",
        runs: { dev: run() },
        terminals: terminals({ hasRunningSubprocess: true }),
      }),
    ).toMatchObject({ phase: "running", script: null, run: { scriptId: "dev" } });
  });
});

describe("findRunServer", () => {
  const server = (terminalId: string | null, port: number): DiscoveredLocalServer => ({
    host: "localhost",
    port,
    url: `http://localhost:${port}/`,
    processName: "node",
    pid: port,
    terminal: terminalId === null ? null : { threadId, terminalId },
  });

  it("picks the server started from the run's terminal", () => {
    const servers = [server(null, 3000), server("terminal-1", 4000), server("terminal-2", 5173)];
    expect(findRunServer(servers, threadId, run())?.port).toBe(5173);
    expect(findRunServer(servers, threadId, run({ terminalId: "terminal-3" }))).toBeNull();
    expect(findRunServer(servers, ThreadId.make("other"), run())).toBeNull();
  });
});

describe("runAwaitsPreview", () => {
  it("waits only while the run is live and has not opened a preview", () => {
    expect(runAwaitsPreview(run(), "running", script("dev"))).toBe(true);
    expect(runAwaitsPreview(run({ previewOpened: true }), "running", script("dev"))).toBe(false);
    expect(runAwaitsPreview(run(), "exited", script("dev"))).toBe(false);
    expect(runAwaitsPreview(run({ terminalId: null }), "starting", undefined)).toBe(false);
  });

  it("leaves scripts with their own auto-opened preview URL alone", () => {
    const withPreview = script("dev", {
      previewUrl: "http://localhost:3000",
      autoOpenPreview: true,
    });
    expect(runAwaitsPreview(run(), "running", withPreview)).toBe(false);
  });
});

describe("buildDetectedProjectScripts", () => {
  it("saves every target with unique ids and runs the first play target", () => {
    const { scripts, runScript } = buildDetectedProjectScripts(
      [
        { name: "Test", command: "pnpm test", icon: "test" },
        { name: "Dev", command: "pnpm dev", icon: "play" },
        { name: "Dev", command: "pnpm start", icon: "play" },
      ],
      ["dev"],
    );
    expect(scripts.map((entry) => [entry.id, entry.command, entry.runOnWorktreeCreate])).toEqual([
      ["test", "pnpm test", false],
      ["dev-2", "pnpm dev", false],
      ["dev-3", "pnpm start", false],
    ]);
    expect(runScript?.id).toBe("dev-2");
  });

  it("has nothing to run without a play target", () => {
    expect(
      buildDetectedProjectScripts([{ name: "Test", command: "pytest", icon: "test" }], [])
        .runScript,
    ).toBeNull();
  });
});

describe("run detection files", () => {
  const paths = ["package.json", "pnpm-lock.yaml", "node_modules/.modules.yaml", "go.mod"];

  it("lists the root before nested directories", () => {
    expect(runDetectionDirectories(paths)).toEqual(["", "node_modules"]);
  });

  it("passes contents only for parsed files and an empty string for other existing ones", () => {
    expect(
      buildRunDetectionFiles(
        paths,
        new Set(["package.json", "pnpm-lock.yaml", "node_modules/.modules.yaml"]),
        { "package.json": '{"scripts":{"dev":"vite"}}' },
      ),
    ).toEqual({
      "package.json": '{"scripts":{"dev":"vite"}}',
      "pnpm-lock.yaml": "",
      "node_modules/.modules.yaml": "",
    });
  });
});

describe("terminalOutputTail", () => {
  it("strips escape sequences and keeps the last redraw of each line", () => {
    expect(
      terminalOutputTail(
        "\u001b]0;title\u0007$ pnpm dev\r\n\u001b[32mready\u001b[0m\r\nloading 10%\rloading 100%\r\n\r\n",
        10,
      ),
    ).toEqual({ text: "$ pnpm dev\nready\nloading 100%", lineStart: 1, lineEnd: 3 });
  });

  it("numbers the kept tail by its position in the whole output", () => {
    const raw = Array.from({ length: 100 }, (_, index) => `line ${index + 1}`).join("\n");
    const tail = terminalOutputTail(raw, 60);
    expect(tail?.lineStart).toBe(41);
    expect(tail?.lineEnd).toBe(100);
    expect(tail?.text.split("\n")[0]).toBe("line 41");
  });

  it("is null for empty output", () => {
    expect(terminalOutputTail("\u001b[2J\r\n", 60)).toBeNull();
  });
});
