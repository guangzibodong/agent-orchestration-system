import { describe, expect, it } from "vitest";
import type { WorkerHealthResponse } from "@mawo/shared";
import {
  buildWorkerHealthDisplay,
  summarizeWorkerHealth
} from "./worker-health-display";

const health: WorkerHealthResponse = {
  ok: false,
  checkedAt: "2026-06-06T01:30:05.079Z",
  staleAfterMs: 60000,
  summary: {
    totalWorkers: 2,
    healthyWorkers: 1,
    staleWorkers: 1
  },
  workers: [
    {
      workerId: "worker-a",
      healthy: true,
      status: "running",
      lastSeenAt: "2026-06-06T01:30:00.000Z",
      ageMs: 5079,
      workflowId: "workflow-123456789",
      jobId: "job-123456789"
    },
    {
      workerId: "worker-b",
      healthy: false,
      status: "idle",
      lastSeenAt: "2026-06-06T01:20:00.000Z",
      ageMs: 605079,
      lastJobStatus: "completed"
    }
  ]
};

describe("worker health display", () => {
  it("summarizes live and stale workers for the operations console", () => {
    expect(summarizeWorkerHealth(health)).toEqual({
      statusLabel: "Degraded",
      severity: "warning",
      total: 2,
      healthy: 1,
      stale: 1,
      running: 1,
      staleAfterLabel: "60s stale window"
    });
  });

  it("maps worker heartbeat rows to operator-facing labels", () => {
    expect(buildWorkerHealthDisplay(health)).toEqual([
      {
        workerId: "worker-a",
        healthLabel: "Healthy",
        statusLabel: "Running",
        severity: "healthy",
        lastSeenAt: "2026-06-06T01:30:00.000Z",
        ageLabel: "5s ago",
        workflowLabel: "workflow-12345",
        jobLabel: "job-12345",
        detail: "Running job job-12345 for workflow workflow-12345."
      },
      {
        workerId: "worker-b",
        healthLabel: "Stale",
        statusLabel: "Idle",
        severity: "danger",
        lastSeenAt: "2026-06-06T01:20:00.000Z",
        ageLabel: "10m ago",
        detail: "Last job completed."
      }
    ]);
  });
});
