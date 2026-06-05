import {
  workflowRunSchema,
  workspaceCleanupPreviewSchema,
  workspaceCleanupResultSchema,
  type WorkflowRun,
  type WorkspaceCleanupPreview,
  type WorkspaceCleanupResult
} from "@mawo/shared";
import { canCleanupWorkflowStatus } from "./workflow-actions";

type ApiClient = (path: string, init?: RequestInit) => Promise<unknown>;

export type WorkspaceCleanupPreviewDisplay = {
  statusLabel: string;
  summary: string;
  blockedReason?: string;
  rows: Array<{
    task: string;
    branch: string;
    path: string;
    status: string;
  }>;
};

export async function loadWorkflowWorkspacePreview(
  api: ApiClient,
  workflowId: string
): Promise<WorkspaceCleanupPreview> {
  const preview = await api(`/workflows/${workflowId}/workspaces`);
  return workspaceCleanupPreviewSchema.parse(preview);
}

export async function cleanupWorkflowWorkspaces(
  api: ApiClient,
  workflow: WorkflowRun
): Promise<WorkflowRun> {
  const result = await cleanupWorkflowWorkspacesWithResult(api, workflow);
  return result.workflow;
}

export async function cleanupWorkflowWorkspacesWithResult(
  api: ApiClient,
  workflow: WorkflowRun
): Promise<{ cleanup?: WorkspaceCleanupResult; workflow: WorkflowRun }> {
  if (!canCleanupWorkflowStatus(workflow.status)) {
    return { workflow };
  }

  const cleanup = await api(`/workflows/${workflow.id}/workspaces/cleanup`, {
    method: "POST",
    body: "{}"
  });

  const refreshed = await api(`/workflows/${workflow.id}`);
  return {
    cleanup: workspaceCleanupResultSchema.parse(cleanup),
    workflow: workflowRunSchema.parse(refreshed)
  };
}

export function buildWorkspaceCleanupPreviewDisplay(
  preview: WorkspaceCleanupPreview
): WorkspaceCleanupPreviewDisplay {
  return {
    statusLabel: buildCleanupStatusLabel(preview),
    summary: `${preview.workspaceCount} ${pluralize(
      preview.workspaceCount,
      "tracked workspace"
    )}, ${preview.existingCount} still on disk`,
    blockedReason: preview.blockedReason,
    rows: preview.workspaces.map((workspace) => ({
      task: workspace.taskTitle,
      branch: workspace.branch,
      path: workspace.path,
      status: workspace.exists ? "Present" : "Missing"
    }))
  };
}

function buildCleanupStatusLabel(preview: WorkspaceCleanupPreview): string {
  if (preview.cleanupAllowed && preview.workspaceCount === 0) {
    return "No cleanup targets";
  }

  return preview.cleanupAllowed ? "Cleanup ready" : "Cleanup blocked";
}

function pluralize(count: number, noun: string): string {
  return count === 1 ? noun : `${noun}s`;
}
