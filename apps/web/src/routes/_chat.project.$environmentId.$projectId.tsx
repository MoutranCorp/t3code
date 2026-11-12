import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { createFileRoute } from "@tanstack/react-router";

import { ProjectScreen } from "../components/project/ProjectScreen";

export const Route = createFileRoute("/_chat/project/$environmentId/$projectId")({
  component: ProjectRoute,
});

function ProjectRoute() {
  const { environmentId, projectId } = Route.useParams();
  return (
    <ProjectScreen
      key={`${environmentId}:${projectId}`}
      environmentId={environmentId as EnvironmentId}
      projectId={projectId as ProjectId}
    />
  );
}
