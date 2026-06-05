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
  "workflow.created": "Workflow Created",
  "workflow.enqueued": "Workflow Enqueued",
  "workflow.retry_requested": "Retry Requested",
  "workflow.reviewed": "Workflow Reviewed",
  "workflow.workspaces_cleaned": "Workspaces Cleaned",
  "workflow.task_started": "Task Started",
  "workflow.task_completed": "Task Completed",
  "workflow.gate_started": "Gate Started",
  "workflow.gate_completed": "Gate Completed",
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

  return entries.map(([key, value]) => `${key}=${value}`).join(", ");
}
