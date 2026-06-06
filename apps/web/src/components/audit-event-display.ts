import type { AuditEvent, AuditEventType } from "@mawo/shared";

export type AuditEventDisplay = {
  id: string;
  label: string;
  actor: string;
  createdAt: string;
  workflowLabel?: string;
  jobLabel?: string;
  metadataLabel: string;
};

const eventLabels: Record<AuditEventType, string> = {
  "repository.registered": "Repository Registered",
  "repository.updated": "Repository Updated",
  "repository.deleted": "Repository Deleted",
  "workflow.created": "Workflow Created",
  "workflow.enqueued": "Workflow Enqueued",
  "workflow.retry_requested": "Retry Requested",
  "workflow.reviewed": "Workflow Reviewed",
  "workflow.artifact_read": "Artifact Read",
  "workflow.merge_candidate_applied": "Merge Candidate Applied",
  "workflow.workspaces_cleaned": "Workspaces Cleaned",
  "workflow.task_started": "Task Started",
  "workflow.task_completed": "Task Completed",
  "workflow.gate_started": "Gate Started",
  "workflow.gate_completed": "Gate Completed",
  "worker.heartbeat": "Worker Heartbeat",
  "job.recovered": "Job Recovered",
  "job.claimed": "Job Claimed",
  "job.completed": "Job Completed",
  "job.failed": "Job Failed",
  "job.lease_lost": "Job Lease Lost",
  "job.canceled": "Job Canceled"
};

export function buildAuditEventDisplay(
  events: AuditEvent[]
): AuditEventDisplay[] {
  return events.map((event) => ({
    id: event.id,
    label: eventLabels[event.type],
    actor: event.actor ?? "system",
    createdAt: event.createdAt,
    workflowLabel: shortId(event.workflowId),
    jobLabel: shortId(event.jobId),
    metadataLabel: formatMetadata(event.type, event.metadata)
  }));
}

export function summarizeAuditEvents(events: AuditEvent[]): {
  total: number;
  operatorActions: number;
} {
  return {
    total: events.length,
    operatorActions: events.filter((event) => event.actor === "operator").length
  };
}

function shortId(id?: string): string | undefined {
  return id?.slice(0, 9);
}

function formatMetadata(
  type: AuditEventType,
  metadata?: Record<string, string>
): string {
  const entries = Object.entries(metadata ?? {});

  if (entries.length === 0) {
    return "No metadata";
  }

  if (type === "workflow.retry_requested") {
    return formatRetryMetadata(metadata ?? {});
  }

  return entries
    .map(([key, value]) => `${key}=${compactMetadataValue(value)}`)
    .join(", ");
}

function formatRetryMetadata(metadata: Record<string, string>): string {
  const parts = [
    metadata.previousStatus && metadata.status
      ? `${metadata.previousStatus} -> ${metadata.status}`
      : metadata.status
        ? `status ${metadata.status}`
        : undefined,
    metadata.cleanedCount
      ? `cleaned ${metadata.cleanedCount} ${pluralize(
          Number(metadata.cleanedCount),
          "workspace"
        )}`
      : undefined,
    metadata.cleanedTaskIds
      ? `tasks ${compactMetadataValue(metadata.cleanedTaskIds, 24)}`
      : undefined,
    metadata.cleanedBranches
      ? `branches ${compactMetadataValue(metadata.cleanedBranches, 16)}`
      : undefined,
    metadata.cleanedPaths
      ? `paths ${compactMetadataValue(metadata.cleanedPaths, 57)}`
      : undefined
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(" / ") : "No metadata";
}

function compactMetadataValue(value: string, maxLength = 58): string {
  if (value.length <= maxLength) {
    return value;
  }

  const headLength = Math.min(24, Math.max(9, Math.floor(maxLength * 0.55)));
  const pathSegment = value.split(/[\\/]/).at(-1);

  if (pathSegment && pathSegment.length <= maxLength - headLength - 3) {
    return `${value.slice(0, headLength)}...${pathSegment}`;
  }

  const tailLength = maxLength - headLength - 3;

  return `${value.slice(0, headLength)}...${value.slice(-tailLength)}`;
}

function pluralize(count: number, noun: string): string {
  return count === 1 ? noun : `${noun}s`;
}
