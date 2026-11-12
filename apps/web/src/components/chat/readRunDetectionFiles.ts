import type { EnvironmentId } from "@t3tools/contracts";
import { executeAtomQuery } from "@t3tools/client-runtime/state/runtime";
import { RUN_DETECTION_FILES } from "@t3tools/shared/projectRunDetection";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { projectEnvironment } from "~/state/projects";
import {
  buildRunDetectionFiles,
  RUN_DETECTION_CONTENT_FILES,
  runDetectionDirectories,
} from "./projectRunControl.logic";

const QUIET = { reportFailure: false, reportDefect: false, refresh: true } as const;

/**
 * Lockfiles can be megabytes, so existence comes from directory listings and only the few
 * files the detector parses are read. Unreadable paths count as missing.
 */
export async function readRunDetectionFiles(
  environmentId: EnvironmentId,
  cwd: string,
): Promise<Record<string, string>> {
  const existingFiles = new Set<string>();
  const existingDirectories = new Set([""]);
  for (const directoryPath of runDetectionDirectories(RUN_DETECTION_FILES)) {
    if (!existingDirectories.has(directoryPath)) continue;
    const listing = await executeAtomQuery(
      appAtomRegistry,
      projectEnvironment.listEntries({ environmentId, input: { cwd, directoryPath } }),
      QUIET,
    );
    if (listing._tag === "Failure") continue;
    for (const entry of listing.value.entries) {
      (entry.kind === "directory" ? existingDirectories : existingFiles).add(entry.path);
    }
  }
  const contentPaths = RUN_DETECTION_FILES.filter(
    (path) => RUN_DETECTION_CONTENT_FILES.has(path) && existingFiles.has(path),
  );
  const contents = Object.fromEntries(
    await Promise.all(
      contentPaths.map(async (relativePath) => {
        const result = await executeAtomQuery(
          appAtomRegistry,
          projectEnvironment.readFile({
            environmentId,
            input: { cwd, relativePath, allowMissing: true },
          }),
          QUIET,
        );
        return [
          relativePath,
          result._tag === "Success" && result.value.exists !== false ? result.value.contents : null,
        ] as const;
      }),
    ),
  );
  return buildRunDetectionFiles(RUN_DETECTION_FILES, existingFiles, contents);
}
