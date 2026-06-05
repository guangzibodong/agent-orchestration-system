import type { AuditEvent, RunReport, WorkflowJob } from "@mawo/shared";

export type JobTimelineSeverity = "healthy" | "warning" | "danger" | "neutral";

export type JobTimelineResponse = {
  job: WorkflowJob;
  workflow?: {
    id: string;
    status: string;
    repositoryId?: string;
    repositoryPath?: string;
  };
  summary?: {
    text: string;
    recommendation: RunReport["recommendation"];
    failedTasks: string[];
    failedGates: string[];
  };
  events: AuditEvent[];
};

export type JobTimelineEventDisplay = {
  id: string;
  label: string;
  actorLabel: string;
  createdAt: string;
  metadataLabel: string;
  severity: JobTimelineSeverity;
};

export type JobTimelineDisplay = {
  jobLabel: string;
  workflowLabel: string;
  repositoryLabel: string;
  statusLabel: string;
  statusSeverity: JobTimelineSeverity;
  summaryLabel: string;
  recommendationLabel: string;
  failureLabel?: string;
  events: JobTimelineEventDisplay[];
};

type ApiClient = (path: string, init?: RequestInit) => Promise<unknown>;

const jobStatusLabels: Record<WorkflowJob["status"], string> = {
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  canceled: "Canceled"
};

const jobStatusSeverities: Record<WorkflowJob["status"], JobTimelineSeverity> = {
  queued: "warning",
  running: "warning",
  completed: "healthy",
  failed: "danger",
  canceled: "neutral"
};

const recommendationLabels: Record<RunReport["recommendation"], string> = {
  ready_for_review: "Ready for review",
  fix_failed_tasks: "Fix failed tasks",
  fix_failed_gates: "Fix failed gates"
};

const eventLabels: Partial<Record<AuditEvent["type"], string>> = {
  "workflow.enqueued": "Queued",
  "workflow.task_started": "Task started",
  "workflow.task_completed": "Task completed",
  "workflow.gate_started": "Gate started",
  "workflow.gate_completed": "Gate completed",
  "job.canceled": "Canceled",
  "job.recovered": "Recovered"
};

export async function loadJobTimeline(
  api: ApiClient,
  jobId: string
): Promise<JobTimelineResponse> {
  return (await api(`/jobs/${jobId}/timeline`)) as JobTimelineResponse;
}

export function buildJobTimelineDisplay(
  timeline: JobTimelineResponse
): JobTimelineDisplay {
  return {
    jobLabel: shortId(timeline.job.id),
    workflowLabel: shortId(timeline.job.workflowId),
    repositoryLabel:
      timeline.workflow?.repositoryPath ??
      timeline.workflow?.repositoryId ??
      "No repository",
    statusLabel: jobStatusLabels[timeline.job.status],
    statusSeverity: jobStatusSeverities[timeline.job.status],
    summaryLabel: timeline.summary?.text ?? "No report summary",
    recommendationLabel: timeline.summary
      ? recommendationLabels[timeline.summary.recommendation]
      : "No recommendation",
    failureLabel: buildFailureLabel(timeline.summary),
    events: [...timeline.events]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map(buildEventDisplay)
  };
}

function buildEventDisplay(event: AuditEvent): JobTimelineEventDisplay {
  return {
    id: event.id,
    label: eventLabels[event.type] ?? event.type,
    actorLabel: event.actor ?? "system",
    createdAt: event.createdAt,
    metadataLabel: buildMetadataLabel(event.metadata),
    severity: eventSeverity(event)
  };
}

function buildFailureLabel(summary?: JobTimelineResponse["summary"]): string | undefined {
  if (!summary) {
    return undefined;
  }

  const failures = [
    summary.failedTasks.length > 0
      ? `Failed tasks: ${summary.failedTasks.join(", ")}`
      : undefined,
    summary.failedGates.length > 0
      ? `Failed gates: ${summary.failedGates.join(", ")}`
      : undefined
  ].filter((item): item is string => Boolean(item));

  return failures.length > 0 ? failures.join(" / ") : undefined;
}

function buildMetadataLabel(metadata?: AuditEvent["metadata"]): string {
  if (!metadata) {
    return "No metadata";
  }

  const parts = [
    metadata.taskId ? `task ${metadata.taskId}` : undefined,
    metadata.gateId ? `gate ${metadata.gateId}` : undefined,
    metadata.status ? `status ${metadata.status}` : undefined,
    metadata.exitCode ? `exit ${metadata.exitCode}` : undefined,
    metadata.durationMs
      ? `duration ${formatDuration(Number(metadata.durationMs))}`
      : undefined,
    metadata.repositoryPath ? `repo ${metadata.repositoryPath}` : undefined,
    !metadata.repositoryPath && metadata.repositoryId
      ? `repo ${metadata.repositoryId}`
      : undefined
  ].filter((item): item is string => Boolean(item));

  return parts.length > 0 ? parts.join(" / ") : "No metadata";
}

function eventSeverity(event: AuditEvent): JobTimelineSeverity {
  if (event.type === "job.canceled") {
    return "neutral";
  }

  const status = event.metadata?.status;
  if (status === "failed") {
    return "danger";
  }

  if (status === "passed" || status === "completed") {
    return "healthy";
  }

  if (event.type.endsWith("_started") || event.type === "workflow.enqueued") {
    return "warning";
  }

  return "neutral";
}

function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return "unknown";
  }

  if (durationMs < 1000) {
    return `${Math.round(durationMs)}ms`;
  }

  const seconds = durationMs / 1000;
  return `${Number(seconds.toFixed(1))}s`;
}

function shortId(id: string): string {
  return id.slice(0, 9);
}
