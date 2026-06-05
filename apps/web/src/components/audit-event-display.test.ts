import { describe, expect, it } from "vitest";
import type { AuditEvent } from "@mawo/shared";
import {
  buildAuditEventDisplay,
  summarizeAuditEvents
} from "./audit-event-display";

const events: AuditEvent[] = [
  {
    id: "event-1",
    type: "workflow.workspaces_cleaned",
    createdAt: "2026-06-05T10:28:10.513Z",
    actor: "operator",
    workflowId: "workflow-123456789",
    metadata: {
      cleaned: "2"
    }
  },
  {
    id: "event-2",
    type: "job.canceled",
    createdAt: "2026-06-05T10:29:10.513Z",
    jobId: "job-abcdef123456",
    metadata: {}
  },
  {
    id: "event-3",
    type: "repository.registered",
    createdAt: "2026-06-05T10:30:10.513Z",
    actor: "operator",
    metadata: {
      repositoryName: "MAWO Core",
      qualityGates: "1"
    }
  }
];

describe("audit event display", () => {
  it("maps audit events to compact operator rows", () => {
    expect(buildAuditEventDisplay(events)).toEqual([
      {
        id: "event-1",
        label: "Workspaces Cleaned",
        actor: "operator",
        createdAt: "2026-06-05T10:28:10.513Z",
        workflowLabel: "workflow-",
        jobLabel: undefined,
        metadataLabel: "cleaned=2"
      },
      {
        id: "event-2",
        label: "Job Canceled",
        actor: "system",
        createdAt: "2026-06-05T10:29:10.513Z",
        workflowLabel: undefined,
        jobLabel: "job-abcde",
        metadataLabel: "No metadata"
      },
      {
        id: "event-3",
        label: "Repository Registered",
        actor: "operator",
        createdAt: "2026-06-05T10:30:10.513Z",
        workflowLabel: undefined,
        jobLabel: undefined,
        metadataLabel: "repositoryName=MAWO Core, qualityGates=1"
      }
    ]);
  });

  it("summarizes audit activity for the console header", () => {
    expect(summarizeAuditEvents(events)).toEqual({
      total: 3,
      operatorActions: 2
    });
  });
});
