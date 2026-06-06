import type { OperationsSnapshot } from "@mawo/shared";
import { describe, expect, it } from "vitest";
import { buildOperationsSummaryCards } from "./operations-summary-display";

describe("operations summary display", () => {
  it("maps snapshot summary counts to operator cards in scan order", () => {
    const summary: OperationsSnapshot["summary"] = {
      queuedJobs: 2,
      runningJobs: 1,
      activeJobs: 3,
      failedJobs: 1,
      needsReviewWorkflows: 2,
      blockedReadinessChecks: 1,
      healthyWorkers: 3,
      totalWorkers: 4
    };

    expect(buildOperationsSummaryCards(summary)).toEqual([
      {
        id: "queued",
        label: "Queued",
        value: "2",
        detail: "2 jobs waiting for workers",
        severity: "warning"
      },
      {
        id: "running",
        label: "Running",
        value: "1",
        detail: "1 job currently running",
        severity: "healthy"
      },
      {
        id: "failed",
        label: "Failed",
        value: "1",
        detail: "1 failed job needs triage",
        severity: "danger"
      },
      {
        id: "needsReview",
        label: "Needs Review",
        value: "2",
        detail: "2 workflows waiting for review",
        severity: "warning"
      },
      {
        id: "blockedReadiness",
        label: "Readiness Blocks",
        value: "1",
        detail: "1 readiness check blocked",
        severity: "danger"
      },
      {
        id: "workers",
        label: "Workers",
        value: "3/4",
        detail: "3 of 4 workers healthy",
        severity: "warning"
      }
    ]);
  });

  it("uses calm labels for an idle healthy snapshot", () => {
    const summary: OperationsSnapshot["summary"] = {
      queuedJobs: 0,
      runningJobs: 0,
      activeJobs: 0,
      failedJobs: 0,
      needsReviewWorkflows: 0,
      blockedReadinessChecks: 0,
      healthyWorkers: 2,
      totalWorkers: 2
    };

    expect(buildOperationsSummaryCards(summary)).toEqual([
      {
        id: "queued",
        label: "Queued",
        value: "0",
        detail: "No queued jobs",
        severity: "neutral"
      },
      {
        id: "running",
        label: "Running",
        value: "0",
        detail: "No jobs running",
        severity: "neutral"
      },
      {
        id: "failed",
        label: "Failed",
        value: "0",
        detail: "No failed jobs",
        severity: "healthy"
      },
      {
        id: "needsReview",
        label: "Needs Review",
        value: "0",
        detail: "No workflows waiting for review",
        severity: "healthy"
      },
      {
        id: "blockedReadiness",
        label: "Readiness Blocks",
        value: "0",
        detail: "No readiness checks blocked",
        severity: "healthy"
      },
      {
        id: "workers",
        label: "Workers",
        value: "2/2",
        detail: "2 of 2 workers healthy",
        severity: "healthy"
      }
    ]);
  });

  it("flags missing worker heartbeats in the worker ratio card", () => {
    const summary: OperationsSnapshot["summary"] = {
      queuedJobs: 0,
      runningJobs: 0,
      activeJobs: 0,
      failedJobs: 0,
      needsReviewWorkflows: 0,
      blockedReadinessChecks: 0,
      healthyWorkers: 0,
      totalWorkers: 0
    };

    const workersCard = buildOperationsSummaryCards(summary).find(
      (card) => card.id === "workers"
    );

    expect(workersCard).toEqual({
      id: "workers",
      label: "Workers",
      value: "0/0",
      detail: "No worker heartbeats",
      severity: "danger"
    });
  });
});
