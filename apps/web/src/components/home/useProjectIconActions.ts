import { create } from "zustand";

import { reportProjectFailure, useProjectGroupUpdate } from "../../hooks/useProjectGroupUpdate";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { projectEnvironment } from "../../state/projects";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";

const useGeneratingIcons = create<{ readonly projectKeys: ReadonlySet<string> }>(() => ({
  projectKeys: new Set(),
}));

function setGenerating(projectKey: string, generating: boolean) {
  useGeneratingIcons.setState(({ projectKeys }) => {
    const next = new Set(projectKeys);
    if (generating) next.add(projectKey);
    else next.delete(projectKey);
    return { projectKeys: next };
  });
}

export function useProjectIconGenerating(projectKey: string): boolean {
  return useGeneratingIcons((state) => state.projectKeys.has(projectKey));
}

/** Draws a project's icon with the text generation model, or returns it to the automatic one. */
export function useProjectIconActions() {
  const { updateProjectGroup } = useProjectGroupUpdate();
  const generateIcon = useOrchestrationCommand(projectEnvironment.generateIcon, {
    reportFailure: false,
  });

  const generate = async (project: SidebarProjectSnapshot) => {
    if (useGeneratingIcons.getState().projectKeys.has(project.projectKey)) return;
    setGenerating(project.projectKey, true);
    try {
      const result = await generateIcon({
        environmentId: project.environmentId,
        input: { projectId: project.id },
      });
      if (result._tag === "Failure") {
        reportProjectFailure("Could not generate an icon", result);
        return;
      }
      // The server stored it on one checkout; the project's other checkouts get the same drawing.
      const icon = result.value.projectIcon;
      const others = project.memberProjects.filter(
        (member) => member.environmentId !== project.environmentId || member.id !== project.id,
      );
      if (icon && others.length > 0) {
        await updateProjectGroup(others, { projectIcon: icon }, "Could not copy the icon");
      }
    } finally {
      setGenerating(project.projectKey, false);
    }
  };

  const reset = (project: SidebarProjectSnapshot) =>
    updateProjectGroup(project.memberProjects, { projectIcon: null }, "Could not reset the icon");

  return { generate, reset };
}
