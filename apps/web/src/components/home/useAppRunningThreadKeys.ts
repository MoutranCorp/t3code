import { useAtomValue } from "@effect/atom-react";
import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import { AuthTerminalReadScope } from "@t3tools/contracts";

import { useProjectRunStore } from "../../projectRunStore";
import { environmentAtomList, environmentIdsKey } from "../../state/environmentAtomList";
import { useEnvironmentsWithScope } from "../../state/session";
import { knownTerminalSessionsAtom } from "../../state/terminalSessions";
import { resolveAppRunningThreadKeys } from "./homeScreen.logic";

const runTerminalSessionsAtom = environmentAtomList(
  "web-home-run-terminal-sessions",
  (environmentId) => knownTerminalSessionsAtom(environmentId, null),
);

/** Threads whose Run is starting or running. Reads terminal metadata only where runs exist. */
export function useAppRunningThreadKeys(): ReadonlySet<string> {
  const runsByThreadKey = useProjectRunStore((state) => state.runsByThreadKey);
  const environmentIds = [
    ...new Set(
      Object.keys(runsByThreadKey).flatMap((key) => parseScopedThreadKey(key)?.environmentId ?? []),
    ),
  ].toSorted();
  const readable = useEnvironmentsWithScope(
    environmentIds.map((environmentId) => ({ environmentId })),
    AuthTerminalReadScope,
  );
  const readableIds = environmentIds.filter((environmentId) => readable.has(environmentId));
  const sessions = useAtomValue(runTerminalSessionsAtom(environmentIdsKey(readableIds)));
  return resolveAppRunningThreadKeys(
    runsByThreadKey,
    new Map(readableIds.map((environmentId, index) => [environmentId, sessions[index] ?? null])),
  );
}
