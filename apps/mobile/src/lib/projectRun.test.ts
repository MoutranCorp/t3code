import { describe, expect, it } from "vite-plus/test";

import { deriveProjectRunPhase, resolveReachableAppUrl, RUN_START_GRACE_MS } from "./projectRun";

describe("deriveProjectRunPhase", () => {
  const run = { scriptId: "dev", command: "bun dev", terminalId: "term-2", startedAt: 1_000 };
  const terminal = (status: "starting" | "running" | "exited", hasRunningSubprocess: boolean) => [
    { terminalId: "term-2", status, hasRunningSubprocess },
  ];
  const late = run.startedAt + RUN_START_GRACE_MS;

  it("follows the run's terminal and ends one that never started after the grace", () => {
    expect(deriveProjectRunPhase(undefined, [], late)).toBe("idle");
    expect(deriveProjectRunPhase(run, [], run.startedAt)).toBe("starting");
    expect(deriveProjectRunPhase(run, terminal("running", false), run.startedAt)).toBe("starting");
    expect(deriveProjectRunPhase(run, terminal("running", true), late)).toBe("running");
    expect(deriveProjectRunPhase(run, terminal("running", false), late)).toBe("idle");
    expect(deriveProjectRunPhase(run, terminal("exited", false), run.startedAt)).toBe("idle");
    expect(deriveProjectRunPhase(run, null, run.startedAt)).toBe("starting");
    expect(deriveProjectRunPhase(run, null, late)).toBe("idle");
  });
});

describe("resolveReachableAppUrl", () => {
  it.each([
    [
      "http://localhost:5173/app?x=1",
      "http://192.168.1.20:3773",
      "http://192.168.1.20:5173/app?x=1",
    ],
    ["http://127.0.0.1:3000", "https://mac.tail1234.ts.net", "http://mac.tail1234.ts.net:3000/"],
    ["http://0.0.0.0:8080/", "http://[fd7a:115c:a1e0::1]:3773", "http://[fd7a:115c:a1e0::1]:8080/"],
    ["http://localhost:5173/", "http://localhost:3773", "http://localhost:5173/"],
    ["http://192.168.1.20:5173/", "https://relay.example.com", "http://192.168.1.20:5173/"],
    ["http://localhost:5173/", "https://relay.example.com", null],
  ])("reaches %s through %s", (url, environment, expected) => {
    expect(resolveReachableAppUrl(url, environment)).toBe(expected);
  });
});
