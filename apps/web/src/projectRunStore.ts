import type { ProjectScript, ScopedProjectRef } from "@t3tools/contracts";
import { create } from "zustand";

import { RUN_START_GRACE_MS, type ProjectRun } from "./components/chat/projectRunControl.logic";

type ThreadRuns = Readonly<Record<string, ProjectRun>>;

interface ProjectRunStoreState {
  readonly runsByThreadKey: Readonly<Record<string, ThreadRuns>>;
  /** A run asked for from outside a thread; the project's Run control starts it once. */
  readonly pendingRunRequest: ScopedProjectRef | null;
}

const EMPTY_THREAD_RUNS: ThreadRuns = Object.freeze({});

/** Runs started from the Run control, in memory, keyed by thread and script. */
export const useProjectRunStore = create<ProjectRunStoreState>(() => ({
  runsByThreadKey: {},
  pendingRunRequest: null,
}));

export function selectThreadRuns(state: ProjectRunStoreState, threadKey: string): ThreadRuns {
  return state.runsByThreadKey[threadKey] ?? EMPTY_THREAD_RUNS;
}

export function selectProjectRunRequested(
  state: ProjectRunStoreState,
  project: { readonly environmentId: string; readonly id: string },
): boolean {
  const request = state.pendingRunRequest;
  return request?.environmentId === project.environmentId && request.projectId === project.id;
}

export function requestProjectRun(projectRef: ScopedProjectRef): void {
  useProjectRunStore.setState({ pendingRunRequest: projectRef });
}

/** True only for the first caller of the requested project, so a request runs once. */
export function takeProjectRunRequest(project: {
  readonly environmentId: string;
  readonly id: string;
}): boolean {
  if (!selectProjectRunRequested(useProjectRunStore.getState(), project)) return false;
  useProjectRunStore.setState({ pendingRunRequest: null });
  return true;
}

let nextRunId = 0;

function updateRun(
  threadKey: string,
  scriptId: string,
  runId: number,
  update: (run: ProjectRun) => ProjectRun | null,
): void {
  useProjectRunStore.setState((state) => {
    const runs = selectThreadRuns(state, threadKey);
    const run = runs[scriptId];
    if (!run || run.id !== runId) return state;
    const next = update(run);
    if (next === run) return state;
    const { [scriptId]: _removed, ...rest } = runs;
    return {
      runsByThreadKey: {
        ...state.runsByThreadKey,
        [threadKey]: next === null ? rest : { ...rest, [scriptId]: next },
      },
    };
  });
}

/** Replaces any earlier run of the script. Returns the new run's id. */
export function beginProjectRun(
  threadKey: string,
  script: Pick<ProjectScript, "id" | "command" | "icon">,
): number {
  const id = (nextRunId += 1);
  const scriptId = script.id;
  const run: ProjectRun = {
    id,
    scriptId,
    command: script.command,
    longRunning: script.icon === "play",
    terminalId: null,
    sawTerminal: false,
    sawRunning: false,
    startGraceElapsed: false,
    previewOpened: false,
  };
  useProjectRunStore.setState((state) => ({
    runsByThreadKey: {
      ...state.runsByThreadKey,
      [threadKey]: { ...selectThreadRuns(state, threadKey), [scriptId]: run },
    },
  }));
  setTimeout(
    () =>
      updateRun(threadKey, scriptId, id, (current) => ({ ...current, startGraceElapsed: true })),
    RUN_START_GRACE_MS,
  );
  return id;
}

export function attachProjectRunTerminal(
  threadKey: string,
  scriptId: string,
  runId: number,
  terminalId: string,
): void {
  updateRun(threadKey, scriptId, runId, (run) => ({ ...run, terminalId }));
}

export function replaceProjectRun(threadKey: string, run: ProjectRun): void {
  updateRun(threadKey, run.scriptId, run.id, () => run);
}

/** True only for the first caller, so a run opens its preview at most once. */
export function claimProjectRunPreview(threadKey: string, run: ProjectRun): boolean {
  let claimed = false;
  updateRun(threadKey, run.scriptId, run.id, (current) => {
    if (current.previewOpened) return current;
    claimed = true;
    return { ...current, previewOpened: true };
  });
  return claimed;
}

export function forgetProjectRun(
  threadKey: string,
  run: Pick<ProjectRun, "scriptId" | "id">,
): void {
  updateRun(threadKey, run.scriptId, run.id, () => null);
}
