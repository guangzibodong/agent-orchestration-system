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
      }
    ]);
  });

  it("summarizes audit activity for the console header", () => {
    expect(summarizeAuditEvents(events)).toEqual({
      total: 2,
      operatorActions: 1
    });
  });
});
