import { createFileRoute, Navigate } from "@tanstack/react-router";

import { NoProjectsHero } from "../components/NoProjectsHero";
import { HostedEmptyState } from "../components/HostedEmptyState";
import { useAllEnvironmentShellsBootstrapped, useProjects } from "../state/entities";
import { useEnvironments } from "../state/environments";

function ChatIndexRouteView() {
  const { authGateState } = Route.useRouteContext();
  const { environments, isReady } = useEnvironments();

  if (authGateState.status === "hosted-static") {
    if (!isReady) return null;
    if (environments.length === 0) return <HostedEmptyState />;
  }

  return <IndexDraftLanding />;
}

function IndexDraftLanding() {
  const projects = useProjects();
  const bootstrapped = useAllEnvironmentShellsBootstrapped();

  if (projects.some((project) => project.archivedAt == null)) {
    return <Navigate to="/home" replace />;
  }
  // A pending environment cannot prove the workspace is empty.
  return bootstrapped ? <NoProjectsHero /> : null;
}

export const Route = createFileRoute("/_chat/")({
  component: ChatIndexRouteView,
});
