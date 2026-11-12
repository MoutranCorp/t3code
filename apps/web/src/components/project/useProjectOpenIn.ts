import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";

import { useRemoteOpenState } from "~/remoteOpen";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { hostEnvironmentIdAtom } from "~/state/primaryEnvironment";
import { primaryServerKeybindingsAtom, serverEnvironment } from "~/state/server";
import { shouldShowOpenInPicker } from "../chat/OpenInPicker.logic";

/** What the "Open in" picker needs, and whether this client can open the environment's files. */
export function useProjectOpenIn(environmentId: EnvironmentId, projectName: string) {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const availableEditors =
    useAtomValue(serverEnvironment.configValueAtom(environmentId))?.availableEditors ?? [];
  const remoteOpenState = useRemoteOpenState(environmentId);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const hostEnvironmentId = useAtomValue(hostEnvironmentIdAtom);
  const show = shouldShowOpenInPicker({
    activeProjectName: projectName,
    activeThreadEnvironmentId: environmentId,
    primaryEnvironmentId,
    hostEnvironmentId,
    remoteOpenMode: remoteOpenState.mode,
  });
  return { show, keybindings, availableEditors };
}
