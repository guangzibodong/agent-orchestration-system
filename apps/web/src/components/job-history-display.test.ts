import { describe, expect, it } from "vitest";
import type { WorkflowJob } from "@mawo/shared";
import {
  buildJobHistoryDisplay,
  summarizeJobHistory
} from "./job-history-display";

const jobs: WorkflowJob[] = [
  {
    id: "job-123456789",
    workflowId: "workflow-123456789",
    status: "completed",
    createdAt: "2026-06-05T10:28:00.000Z",
    updatedAt: "2026-06-05T10:30:10.000Z",
    startedAt: "2026-06-05T10:28:10.000Z",
    finishedAt: "2026-06-05T10:30:10.000Z"
  },
  {
    id: "job-abcdef123",
    workflowId: "workflow-abcdef123",
    status: "failed",
    createdAt: "2026-06-05T10:31:00.000Z",
    updatedAt: "2026-06-05T10:31:30.000Z",
    error: "quality gate failed after timeout"
  }
];

describe("job history display", () => {
  it("maps workflow jobs to compact run history rows", () => {
    expect(buildJobHistoryDisplay(jobs)).toEqual([
      {
        id: "job-123456789",
        jobLabel: "job-12345",
        workflowLabel: "workflow-",
        statusLabel: "Completed",
        severity: "healthy",
        durationLabel: "2m 0s",
        updatedAt: "2026-06-05T10:30:10.000Z",
        errorLabel: undefined
      },
      {
        id: "job-abcdef123",
        jobLabel: "job-abcde",
        workflowLabel: "workflow-",
        statusLabel: "Failed",
        severity: "danger",
        durationLabel: "Not finished",
        updatedAt: "2026-06-05T10:31:30.000Z",
        errorLabel: "quality gate failed after timeout"
      }
    ]);
  });

  it("summarizes active and failed jobs for operations", () => {
    expect(summarizeJobHistory(jobs)).toEqual({
      total: 2,
      active: 0,
      failed: 1
    });
  });
});
