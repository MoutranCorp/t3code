import {
  AuthTerminalReadScope,
  type EnvironmentId,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";

import type { ProjectRun } from "../lib/projectRun";
import { scopedProjectKey } from "../lib/scopedEntities";
import { appAtomRegistry } from "./atom-registry";
import { environmentSession, sessionHasScope } from "./session";
import { terminalEnvironment } from "./terminal";

export interface ThreadProjectRun extends ProjectRun {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
}

/** Runs started from this device, by scoped thread key. */
export const projectRunsAtom = Atom.make<Readonly<Record<string, ThreadProjectRun>>>({}).pipe(
  Atom.keepAlive,
  Atom.withLabel("mobile-project-runs"),
);

export function recordProjectRun(threadKey: string, run: ThreadProjectRun) {
  appAtomRegistry.set(projectRunsAtom, {
    ...appAtomRegistry.get(projectRunsAtom),
    [threadKey]: run,
  });
}

export function forgetProjectRun(threadKey: string, run: ThreadProjectRun) {
  const { [threadKey]: current, ...rest } = appAtomRegistry.get(projectRunsAtom);
  if (current === run) appAtomRegistry.set(projectRunsAtom, rest);
}

/** Scoped project keys whose run from this device has a live subprocess. */
export const runningProjectKeysAtom = Atom.make((get): ReadonlySet<string> => {
  const running = new Set<string>();
  for (const run of Object.values(get(projectRunsAtom))) {
    const session = get(environmentSession.sessionStateAtom(run.environmentId));
    if (!sessionHasScope(session, AuthTerminalReadScope)) continue;
    const metadata = get(
      terminalEnvironment.metadata({ environmentId: run.environmentId, input: null }),
    );
    if (!AsyncResult.isSuccess(metadata)) continue;
    const live = metadata.value.some(
      (terminal) =>
        terminal.threadId === run.threadId &&
        terminal.terminalId === run.terminalId &&
        terminal.hasRunningSubprocess,
    );
    if (live) running.add(scopedProjectKey(run.environmentId, run.projectId));
  }
  return running;
}).pipe(Atom.withLabel("mobile-running-project-keys"));
