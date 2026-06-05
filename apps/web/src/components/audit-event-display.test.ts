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
  },
  {
    id: "event-4",
    type: "repository.updated",
    createdAt: "2026-06-05T10:31:10.513Z",
    actor: "operator",
    metadata: {
      repositoryName: "MAWO Core",
      previousRepositoryName: "MAWO Old"
    }
  },
  {
    id: "event-5",
    type: "repository.deleted",
    createdAt: "2026-06-05T10:32:10.513Z",
    actor: "operator",
    metadata: {
      repositoryName: "Old repo"
    }
  },
  {
    id: "event-6",
    type: "job.recovered",
    createdAt: "2026-06-05T10:33:10.513Z",
    actor: "system",
    workflowId: "workflow-recovered",
    jobId: "job-recovered",
    metadata: {
      previousStatus: "running",
      recoveredStatus: "failed"
    }
  },
  {
    id: "event-7",
    type: "workflow.artifact_read",
    createdAt: "2026-06-05T10:34:10.513Z",
    actor: "operator",
    workflowId: "workflow-artifact",
    metadata: {
      artifactPath:
        "C:/mawo/artifacts/workflow-artifact/report.json",
      maxBytes: "65536",
      truncated: "false"
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
      },
      {
        id: "event-4",
        label: "Repository Updated",
        actor: "operator",
        createdAt: "2026-06-05T10:31:10.513Z",
        workflowLabel: undefined,
        jobLabel: undefined,
        metadataLabel:
          "repositoryName=MAWO Core, previousRepositoryName=MAWO Old"
      },
      {
        id: "event-5",
        label: "Repository Deleted",
        actor: "operator",
        createdAt: "2026-06-05T10:32:10.513Z",
        workflowLabel: undefined,
        jobLabel: undefined,
        metadataLabel: "repositoryName=Old repo"
      },
      {
        id: "event-6",
        label: "Job Recovered",
        actor: "system",
        createdAt: "2026-06-05T10:33:10.513Z",
        workflowLabel: "workflow-",
        jobLabel: "job-recov",
        metadataLabel: "previousStatus=running, recoveredStatus=failed"
      },
      {
        id: "event-7",
        label: "Artifact Read",
        actor: "operator",
        createdAt: "2026-06-05T10:34:10.513Z",
        workflowLabel: "workflow-",
        jobLabel: undefined,
        metadataLabel:
          "artifactPath=C:/mawo/artifacts/workflow-artifact/report.json, maxBytes=65536, truncated=false"
      }
    ]);
  });

  it("summarizes audit activity for the console header", () => {
    expect(summarizeAuditEvents(events)).toEqual({
      total: 7,
      operatorActions: 5
    });
  });

  it("keeps long cleanup metadata compact while preserving useful path context", () => {
    const [event] = buildAuditEventDisplay([
      {
        id: "event-long",
        type: "workflow.workspaces_cleaned",
        createdAt: "2026-06-05T10:32:10.513Z",
        actor: "operator",
        metadata: {
          cleanedPaths:
            "C:/Users/Harry/AppData/Local/Temp/mawo-smoke-repo/.mawo/worktrees/workflow-task-1234567890",
          cleanedBranches:
            "mawo/workflow-with-a-very-long-identifier/flaky-task-1234567890"
        }
      }
    ]);

    expect(event?.metadataLabel).toContain("cleanedPaths=C:/Users");
    expect(event?.metadataLabel).toContain("...workflow-task-1234567890");
    expect(event?.metadataLabel).toContain("cleanedBranches=mawo/work");
    expect(event?.metadataLabel.length).toBeLessThanOrEqual(150);
  });
});
