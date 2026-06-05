import { describe, expect, it } from "vitest";
import type { JobTimelineResponse } from "./job-timeline-display";
import {
  buildJobTimelineDisplay,
  loadJobTimeline
} from "./job-timeline-display";

const timeline: JobTimelineResponse = {
  job: {
    id: "job-123456789",
    workflowId: "workflow-123456789",
    status: "completed",
    createdAt: "2026-06-05T10:00:00.000Z",
    updatedAt: "2026-06-05T10:02:00.000Z",
    startedAt: "2026-06-05T10:00:05.000Z",
    finishedAt: "2026-06-05T10:02:00.000Z"
  },
  workflow: {
    id: "workflow-123456789",
    status: "gate_failed",
    repositoryId: "repo-1",
    repositoryPath: "C:/work/repo"
  },
  summary: {
    text: "Unit gate failed after implementation.",
    recommendation: "fix_failed_gates",
    failedTasks: [],
    failedGates: ["unit-tests"]
  },
  events: [
    {
      id: "event-gate-completed",
      type: "workflow.gate_completed",
      workflowId: "workflow-123456789",
      createdAt: "2026-06-05T10:01:45.000Z",
      actor: "runner",
      metadata: {
        gateId: "unit-tests",
        status: "failed",
        exitCode: "1",
        durationMs: "4200"
      }
    },
    {
      id: "event-enqueued",
      type: "workflow.enqueued",
      workflowId: "workflow-123456789",
      jobId: "job-123456789",
      createdAt: "2026-06-05T10:00:00.000Z",
      actor: "operator",
      metadata: {
        repositoryPath: "C:/work/repo",
        status: "queued"
      }
    },
    {
      id: "event-task-completed",
      type: "workflow.task_completed",
      workflowId: "workflow-123456789",
      createdAt: "2026-06-05T10:00:45.000Z",
      actor: "runner",
      metadata: {
        taskId: "plan",
        status: "passed",
        exitCode: "0",
        durationMs: "1500"
      }
    }
  ]
};

describe("job timeline display", () => {
  it("maps timeline responses to chronological operator rows", () => {
    expect(buildJobTimelineDisplay(timeline)).toEqual({
      jobLabel: "job-12345",
      workflowLabel: "workflow-",
      repositoryLabel: "C:/work/repo",
      statusLabel: "Completed",
      statusSeverity: "healthy",
      summaryLabel: "Unit gate failed after implementation.",
      recommendationLabel: "Fix failed gates",
      failureLabel: "Failed gates: unit-tests",
      events: [
        {
          id: "event-enqueued",
          label: "Queued",
          actorLabel: "operator",
          createdAt: "2026-06-05T10:00:00.000Z",
          metadataLabel: "status queued / repo C:/work/repo",
          severity: "warning"
        },
        {
          id: "event-task-completed",
          label: "Task completed",
          actorLabel: "runner",
          createdAt: "2026-06-05T10:00:45.000Z",
          metadataLabel: "task plan / status passed / exit 0 / duration 1.5s",
          severity: "healthy"
        },
        {
          id: "event-gate-completed",
          label: "Gate completed",
          actorLabel: "runner",
          createdAt: "2026-06-05T10:01:45.000Z",
          metadataLabel:
            "gate unit-tests / status failed / exit 1 / duration 4.2s",
          severity: "danger"
        }
      ]
    });
  });

  it("loads the timeline endpoint for a selected job", async () => {
    const requests: string[] = [];

    const loaded = await loadJobTimeline(async (path) => {
      requests.push(path);
      return timeline;
    }, "job-123456789");

    expect(requests).toEqual(["/jobs/job-123456789/timeline"]);
    expect(loaded.job.id).toBe("job-123456789");
  });
});
