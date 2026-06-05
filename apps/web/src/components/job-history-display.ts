import type { WorkflowJob, WorkflowJobStatus } from "@mawo/shared";

export type JobHistorySeverity = "healthy" | "warning" | "danger" | "neutral";

export type JobHistoryDisplay = {
  id: string;
  jobLabel: string;
  workflowLabel: string;
  statusLabel: string;
  severity: JobHistorySeverity;
  durationLabel: string;
  updatedAt: string;
  errorLabel?: string;
};

const statusLabels: Record<WorkflowJobStatus, string> = {
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  canceled: "Canceled"
};

const statusSeverities: Record<WorkflowJobStatus, JobHistorySeverity> = {
  queued: "warning",
  running: "warning",
  completed: "healthy",
  failed: "danger",
  canceled: "neutral"
};

export function buildJobHistoryDisplay(
  jobs: WorkflowJob[]
): JobHistoryDisplay[] {
  return jobs.map((job) => ({
    id: job.id,
    jobLabel: shortId(job.id),
    workflowLabel: shortId(job.workflowId),
    statusLabel: statusLabels[job.status],
    severity: statusSeverities[job.status],
    durationLabel: formatDuration(job.startedAt, job.finishedAt),
    updatedAt: job.updatedAt,
    errorLabel: job.error
  }));
}

export function summarizeJobHistory(jobs: WorkflowJob[]): {
  total: number;
  active: number;
  failed: number;
} {
  return {
    total: jobs.length,
    active: jobs.filter((job) => job.status === "queued" || job.status === "running")
      .length,
    failed: jobs.filter((job) => job.status === "failed").length
  };
}

function shortId(id: string): string {
  return id.slice(0, 9);
}

function formatDuration(startedAt?: string, finishedAt?: string): string {
  if (!startedAt || !finishedAt) {
    return "Not finished";
  }

  const durationMs = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return "Not finished";
  }

  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${seconds}s`;
}
