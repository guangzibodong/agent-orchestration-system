import { describe, expect, it } from "vitest";
import {
  canCancelJobStatus,
  canRetryWorkflowStatus,
  formatJobStatus,
  parseWorkflowAlreadyRunningJob
} from "./workflow-actions";

describe("workflow actions", () => {
  it("allows retry only for terminal failed workflow states", () => {
    expect(canRetryWorkflowStatus("failed")).toBe(true);
    expect(canRetryWorkflowStatus("gate_failed")).toBe(true);
    expect(canRetryWorkflowStatus("aborted")).toBe(true);
    expect(canRetryWorkflowStatus("ready")).toBe(false);
    expect(canRetryWorkflowStatus("running")).toBe(false);
    expect(canRetryWorkflowStatus("needs_review")).toBe(false);
    expect(canRetryWorkflowStatus(undefined)).toBe(false);
  });

  it("allows cancel only for queued and running jobs", () => {
    expect(canCancelJobStatus("queued")).toBe(true);
    expect(canCancelJobStatus("running")).toBe(true);
    expect(canCancelJobStatus("completed")).toBe(false);
    expect(canCancelJobStatus("failed")).toBe(false);
    expect(canCancelJobStatus("canceled")).toBe(false);
    expect(canCancelJobStatus(undefined)).toBe(false);
  });

  it("formats job status with clear production labels", () => {
    expect(formatJobStatus("queued")).toBe("Queued");
    expect(formatJobStatus("running")).toBe("Running");
    expect(formatJobStatus("completed")).toBe("Completed");
    expect(formatJobStatus("failed")).toBe("Failed");
    expect(formatJobStatus("canceled")).toBe("Canceled");
    expect(formatJobStatus(undefined)).toBe("Unknown");
  });

  it("extracts the active job from duplicate enqueue conflicts", () => {
    const job = {
      id: "job-1",
      workflowId: "workflow-1",
      status: "running",
      createdAt: "2026-06-05T00:00:00.000Z",
      updatedAt: "2026-06-05T00:00:01.000Z"
    };

    expect(
      parseWorkflowAlreadyRunningJob({
        error: "workflow_already_running",
        job
      })
    ).toEqual(job);
    expect(parseWorkflowAlreadyRunningJob({ error: "other", job })).toBeUndefined();
    expect(
      parseWorkflowAlreadyRunningJob({
        error: "workflow_already_running",
        job: { id: "incomplete" }
      })
    ).toBeUndefined();
  });
});
