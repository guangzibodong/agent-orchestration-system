import { describe, expect, it } from "vitest";
import type { WorkflowRun } from "@mawo/shared";
import {
  buildDeliveryConsoleModel,
  mapWorkflowToRequirementSummary
} from "./delivery-console-model";

const baseWorkflow: WorkflowRun = {
  id: "workflow-123456789",
  goal: "Fix checkout test flake",
  status: "ready",
  repositoryPath: "C:/work/shop",
  createdAt: "2026-06-06T09:00:00.000Z",
  updatedAt: "2026-06-06T09:05:00.000Z",
  tasks: [
    {
      id: "task-1",
      title: "Patch failing test",
      status: "waiting"
    }
  ],
  qualityGates: [
    {
      id: "gate-1",
      title: "Unit tests",
      status: "waiting"
    }
  ]
};

describe("delivery console model", () => {
  it("maps workflow execution state into requirement delivery stages", () => {
    expect(mapWorkflowToRequirementSummary(baseWorkflow)).toEqual({
      id: "workflow-123456789",
      title: "Fix checkout test flake",
      repositoryLabel: "C:/work/shop",
      repositorySafety: {
        allowedRootLabel: "Allowed root accepted by API",
        blockedReason: undefined,
        branchLabel: "Branch pending preflight",
        cleanStateLabel: "Clean state pending preflight",
        executionModeLabel: "Direct repository",
        headLabel: "HEAD SHA not reported",
        mergePolicyLabel: "Manual git apply only",
        recoveryAction: "Run repository preflight before mutating actions",
        repositoryLabel: "C:/work/shop"
      },
      requirementStage: "ready_to_run",
      executionStatus: "ready",
      riskLevel: "medium",
      nextAction: "Run isolated workflow",
      nodeLabel: "1 task / 1 gate",
      updatedAt: "2026-06-06T09:05:00.000Z"
    });

    expect(
      mapWorkflowToRequirementSummary({
        ...baseWorkflow,
        status: "gate_failed"
      })
    ).toMatchObject({
      requirementStage: "needs_rework",
      nextAction: "Retry failed gate",
      riskLevel: "high"
    });

    expect(
      mapWorkflowToRequirementSummary({
        ...baseWorkflow,
        status: "completed",
        review: {
          decision: "approved",
          reviewedAt: "2026-06-06T09:20:00.000Z"
        }
      })
    ).toMatchObject({
      requirementStage: "delivered",
      nextAction: "Review delivered evidence",
      riskLevel: "low"
    });
  });

  it("builds repository safety from real workflow repository and workspace evidence", () => {
    const summary = mapWorkflowToRequirementSummary({
      ...baseWorkflow,
      status: "gate_failed",
      executionMode: "worktree",
      tasks: [
        {
          id: "task-1",
          title: "Patch failing test",
          status: "failed",
          workspace: {
            path: "C:/worktrees/shop/task-1",
            branch: "mawo/workflow-123/task-1",
            repoPath: "C:/work/shop"
          }
        }
      ]
    });

    expect(summary.repositorySafety).toEqual({
      allowedRootLabel: "Allowed root accepted by API",
      blockedReason: "Required gate failed; merge-ready conclusion is blocked.",
      branchLabel: "mawo/workflow-123/task-1",
      cleanStateLabel: "Apply clean check required",
      executionModeLabel: "Isolated worktree",
      headLabel: "HEAD SHA not reported",
      mergePolicyLabel: "Manual git apply only",
      recoveryAction: "Retry failed gate",
      repositoryLabel: "C:/work/shop"
    });
  });

  it("marks missing repository safety as blocked setup work", () => {
    const summary = mapWorkflowToRequirementSummary({
      ...baseWorkflow,
      repositoryPath: undefined
    });

    expect(summary.repositorySafety).toMatchObject({
      allowedRootLabel: "Allowed root not checked",
      blockedReason: "Repository path required before execution.",
      cleanStateLabel: "No repository selected",
      recoveryAction: "Register or select a repository",
      repositoryLabel: "No repository selected"
    });
  });

  it("builds KPI and decision queues around user action, not job internals", () => {
    const model = buildDeliveryConsoleModel([
      baseWorkflow,
      {
        ...baseWorkflow,
        id: "workflow-gate-failed",
        goal: "Update billing copy",
        status: "gate_failed",
        updatedAt: "2026-06-06T10:00:00.000Z"
      },
      {
        ...baseWorkflow,
        id: "workflow-review",
        goal: "Harden auth checks",
        status: "needs_review",
        updatedAt: "2026-06-06T10:10:00.000Z"
      }
    ]);

    expect(model.kpis).toEqual({
      activeRequirements: 3,
      needsClarification: 0,
      runningTasks: 0,
      failedGates: 1,
      waitingForReview: 1,
      deliveredLastSevenDays: 0
    });

    expect(model.decisionQueue).toEqual([
      {
        id: "workflow-gate-failed:retry",
        requirementId: "workflow-gate-failed",
        title: "Update billing copy",
        actionLabel: "Retry failed gate",
        severity: "danger"
      },
      {
        id: "workflow-review:review",
        requirementId: "workflow-review",
        title: "Harden auth checks",
        actionLabel: "Review merge candidate",
        severity: "warning"
      }
    ]);
  });

  it("counts only approved deliveries updated inside the last seven days", () => {
    const recentApproved = {
      ...baseWorkflow,
      id: "workflow-recent-approved",
      status: "completed" as const,
      updatedAt: "2026-06-04T09:00:00.000Z",
      review: {
        decision: "approved" as const,
        reviewedAt: "2026-06-04T09:30:00.000Z"
      }
    };
    const oldApproved = {
      ...recentApproved,
      id: "workflow-old-approved",
      updatedAt: "2026-05-20T09:00:00.000Z"
    };
    const recentRejected = {
      ...recentApproved,
      id: "workflow-recent-rejected",
      review: {
        decision: "rejected" as const,
        reviewedAt: "2026-06-04T09:30:00.000Z"
      }
    };

    const model = buildDeliveryConsoleModel(
      [recentApproved, oldApproved, recentRejected],
      new Date("2026-06-06T00:00:00.000Z")
    );

    expect(model.kpis.deliveredLastSevenDays).toBe(1);
  });
});
