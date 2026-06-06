import type { OperationsSnapshot } from "@mawo/shared";
import { describe, expect, it } from "vitest";
import { buildDeliveryTopbarHealthIndicators } from "./delivery-topbar-health";

const baseSnapshot: OperationsSnapshot = {
  checkedAt: "2026-06-06T10:20:00.000Z",
  summary: {
    queuedJobs: 0,
    runningJobs: 0,
    activeJobs: 0,
    failedJobs: 0,
    needsReviewWorkflows: 0,
    blockedReadinessChecks: 0,
    healthyWorkers: 1,
    totalWorkers: 1,
  },
  auditEvents: [],
  jobs: [],
  readiness: {
    ok: true,
    service: "mawo-api",
    checkedAt: "2026-06-06T10:20:00.000Z",
    deploymentMode: "development",
    protectedByToken: true,
    root: "C:/work",
    activeJobs: 0,
    checks: [
      {
        id: "workers",
        label: "Worker health",
        ok: true,
        status: "ready",
        required: false,
        message: "External workers are optional for the active queue backend.",
      },
    ],
  },
  workerHealth: {
    ok: true,
    checkedAt: "2026-06-06T10:20:00.000Z",
    staleAfterMs: 30000,
    summary: {
      totalWorkers: 1,
      healthyWorkers: 1,
      staleWorkers: 0,
    },
    workers: [],
  },
};

describe("delivery topbar health", () => {
  it("builds compact API, worker, and queue indicators in a stable order", () => {
    const indicators = buildDeliveryTopbarHealthIndicators({
      ...baseSnapshot,
      summary: {
        ...baseSnapshot.summary,
        queuedJobs: 2,
        activeJobs: 2,
      },
    });

    expect(indicators).toEqual([
      expect.objectContaining({
        id: "api",
        label: "API",
        value: "Ready",
        severity: "healthy",
      }),
      expect.objectContaining({
        id: "launch",
        label: "Launch",
        value: "Development ready",
        detail: "Development readiness has no blockers",
        severity: "healthy",
      }),
      expect.objectContaining({
        id: "worker",
        label: "Worker",
        value: "1/1",
        severity: "healthy",
      }),
      expect.objectContaining({
        id: "queue",
        label: "Queue",
        value: "2",
        severity: "warning",
      }),
    ]);
  });

  it("shows production readiness blockers as a launch danger signal", () => {
    const indicators = buildDeliveryTopbarHealthIndicators({
      ...baseSnapshot,
      readiness: {
        ...baseSnapshot.readiness,
        ok: false,
        deploymentMode: "production",
        checks: [
          {
            id: "production_config",
            label: "Production configuration",
            ok: false,
            status: "blocked",
            message:
              "MAWO_API_TOKEN must be changed from the example value before launch.",
          },
          {
            id: "state_store",
            label: "State store",
            ok: true,
            status: "ready",
          },
        ],
      },
    });

    expect(indicators.find((indicator) => indicator.id === "launch")).toEqual(
      expect.objectContaining({
        value: "Production blocked",
        detail: "1 readiness check blocks launch",
        severity: "danger",
      }),
    );
  });

  it("uses latest launch gate evidence for the launch indicator when available", () => {
    const indicators = buildDeliveryTopbarHealthIndicators(baseSnapshot, {
      generatedAt: "2026-06-06T16:35:25.938Z",
      root: "C:/work",
      branch: "main",
      commit: "cfa22af",
      dirtyFiles: [],
      checks: [],
      docs: [],
      localDecision: "passed",
      productionDecision: "blocked",
      failureSummaries: [],
      externalBlockers: [
        "db_validate: DATABASE_URL is not configured for Postgres launch verification.",
        "db_migrate_deploy: DATABASE_URL is not configured for Postgres launch verification.",
        "smoke_api_postgres: DATABASE_URL is not configured for Postgres launch verification.",
      ],
      sourcePath: "C:/work/output/launch-readiness/latest.json",
    });

    expect(indicators.find((indicator) => indicator.id === "launch")).toEqual(
      expect.objectContaining({
        value: "Local passed / Prod blocked",
        detail:
          "Postgres launch verification blocked: DATABASE_URL is not configured for Postgres launch verification. 2 more external blockers. Generated 2026-06-06T16:35:25.938Z",
        severity: "warning",
      }),
    );
  });

  it("marks stale launch gate evidence as a danger signal", () => {
    const indicators = buildDeliveryTopbarHealthIndicators(baseSnapshot, {
      generatedAt: "2026-06-06T16:35:25.938Z",
      root: "C:/work",
      branch: "main",
      commit: "24418a0",
      dirtyFiles: [],
      checks: [],
      docs: [],
      localDecision: "passed",
      productionDecision: "blocked",
      failureSummaries: [],
      externalBlockers: [],
      sourcePath: "C:/work/output/launch-readiness/latest.json",
      currentBranch: "main",
      currentCommit: "10de896",
      currentDirtyFiles: [],
      fresh: false,
      staleReasons: ["Evidence commit 24418a0 does not match HEAD 10de896."],
    });

    expect(indicators.find((indicator) => indicator.id === "launch")).toEqual(
      expect.objectContaining({
        value: "Evidence stale",
        detail: "Evidence commit 24418a0 does not match HEAD 10de896.",
        severity: "danger",
      }),
    );
  });

  it("shows failed jobs as the queue danger state", () => {
    const indicators = buildDeliveryTopbarHealthIndicators({
      ...baseSnapshot,
      summary: {
        ...baseSnapshot.summary,
        failedJobs: 1,
      },
    });

    expect(indicators.find((indicator) => indicator.id === "queue")).toEqual(
      expect.objectContaining({
        value: "1 failed",
        detail: "1 failed job needs triage",
        severity: "danger",
      }),
    );
  });

  it("does not mark optional external workers as blocked when none are required", () => {
    const indicators = buildDeliveryTopbarHealthIndicators({
      ...baseSnapshot,
      summary: {
        ...baseSnapshot.summary,
        healthyWorkers: 0,
        totalWorkers: 0,
      },
      workerHealth: {
        ...baseSnapshot.workerHealth,
        ok: false,
        summary: {
          totalWorkers: 0,
          healthyWorkers: 0,
          staleWorkers: 0,
        },
      },
    });

    expect(indicators.find((indicator) => indicator.id === "worker")).toEqual(
      expect.objectContaining({
        value: "No Workers",
        detail: "External workers are optional for the active queue backend.",
        severity: "neutral",
      }),
    );
  });

  it("marks missing workers as blocked when the queue backend requires one", () => {
    const indicators = buildDeliveryTopbarHealthIndicators({
      ...baseSnapshot,
      summary: {
        ...baseSnapshot.summary,
        healthyWorkers: 0,
        totalWorkers: 0,
      },
      readiness: {
        ...baseSnapshot.readiness,
        ok: false,
        checks: [
          {
            id: "workers",
            label: "Worker health",
            ok: false,
            status: "blocked",
            required: true,
            message:
              "Postgres queue backend requires at least one fresh workflow worker heartbeat.",
          },
        ],
      },
      workerHealth: {
        ...baseSnapshot.workerHealth,
        ok: false,
        summary: {
          totalWorkers: 0,
          healthyWorkers: 0,
          staleWorkers: 0,
        },
      },
    });

    expect(indicators.find((indicator) => indicator.id === "worker")).toEqual(
      expect.objectContaining({
        value: "No Workers",
        detail:
          "Postgres queue backend requires at least one fresh workflow worker heartbeat.",
        severity: "danger",
      }),
    );
  });
});
