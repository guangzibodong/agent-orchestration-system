import {
  workflowJobSchema,
  type WorkflowJob,
  type WorkflowJobStatus,
  type WorkflowStatus
} from "@mawo/shared";

const retryableStatuses = new Set<WorkflowStatus>([
  "failed",
  "gate_failed",
  "aborted"
]);

const cleanupWorkflowStatuses = new Set<WorkflowStatus>([
  "completed",
  "aborted",
  "archived"
]);

export type WorkflowJobDisplayStatus = WorkflowJobStatus | "canceled";

const cancelableJobStatuses = new Set<WorkflowJobDisplayStatus>([
  "queued",
  "running"
]);

const jobStatusLabels: Record<WorkflowJobDisplayStatus, string> = {
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  canceled: "Canceled"
};

export function canRetryWorkflowStatus(status?: WorkflowStatus): boolean {
  return status ? retryableStatuses.has(status) : false;
}

export function canCleanupWorkflowStatus(status?: WorkflowStatus): boolean {
  return status ? cleanupWorkflowStatuses.has(status) : false;
}

export function canCancelJobStatus(
  status?: WorkflowJobDisplayStatus
): boolean {
  return status ? cancelableJobStatuses.has(status) : false;
}

export function formatJobStatus(status?: WorkflowJobDisplayStatus): string {
  return status ? jobStatusLabels[status] : "Unknown";
}

export function parseWorkflowAlreadyRunningJob(
  value: unknown
): WorkflowJob | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const conflict = value as {
    error?: unknown;
    job?: unknown;
  };

  if (conflict.error !== "workflow_already_running") {
    return undefined;
  }

  const parsed = workflowJobSchema.safeParse(conflict.job);
  return parsed.success ? parsed.data : undefined;
}
