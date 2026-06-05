import { workflowRunSchema, type WorkflowRun } from "@mawo/shared";
import { canCleanupWorkflowStatus } from "./workflow-actions";

type ApiClient = (path: string, init?: RequestInit) => Promise<unknown>;

export async function cleanupWorkflowWorkspaces(
  api: ApiClient,
  workflow: WorkflowRun
): Promise<WorkflowRun> {
  if (!canCleanupWorkflowStatus(workflow.status)) {
    return workflow;
  }

  await api(`/workflows/${workflow.id}/workspaces/cleanup`, {
    method: "POST",
    body: "{}"
  });

  const refreshed = await api(`/workflows/${workflow.id}`);
  return workflowRunSchema.parse(refreshed);
}
