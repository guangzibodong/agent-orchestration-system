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
  "workflow.workspaces_cleaned": "Workspaces Cleaned",
  "workflow.task_started": "Task Started",
  "workflow.task_completed": "Task Completed",
  "workflow.gate_started": "Gate Started",
  "workflow.gate_completed": "Gate Completed",
  "job.recovered": "Job Recovered",
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
    metadataLabel: formatMetadata(event.metadata)
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

function formatMetadata(metadata?: Record<string, string>): string {
  const entries = Object.entries(metadata ?? {});

  if (entries.length === 0) {
    return "No metadata";
  }

  return entries
    .map(([key, value]) => `${key}=${compactMetadataValue(value)}`)
    .join(", ");
}

function compactMetadataValue(value: string): string {
  const maxLength = 58;

  if (value.length <= maxLength) {
    return value;
  }

  const headLength = 24;
  const pathSegment = value.split(/[\\/]/).at(-1);

  if (pathSegment && pathSegment.length < maxLength - headLength - 3) {
    return `${value.slice(0, headLength)}...${pathSegment}`;
  }

  const tailLength = maxLength - headLength - 3;

  return `${value.slice(0, headLength)}...${value.slice(-tailLength)}`;
}
