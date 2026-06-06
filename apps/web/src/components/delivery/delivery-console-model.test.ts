import { describe, expect, it } from "vitest";
import type { RequirementDeliveryTicket, WorkflowRun } from "@mawo/shared";
import {
  buildDeliveryConsoleModel,
  mapRequirementTicketToSummary,
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
      source: "workflow",
      title: "Fix checkout test flake",
      repositoryLabel: "C:/work/shop",
      repositorySafety: {
        allowedRootLabel: "Allowed root pending preflight",
        blockedReason: undefined,
        branchLabel: "Branch pending preflight",
        cleanStateLabel: "Clean state pending preflight",
        executionModeLabel: "Direct repository",
        headLabel: "HEAD SHA not reported",
        mergePolicyLabel: "No MAWO auto-merge; manual git apply outside MAWO",
        recoveryAction: "Run repository preflight before mutating actions",
        repositoryLabel: "C:/work/shop"
      },
      requirementStage: "ready_to_run",
      executionStatus: "ready",
      riskLevel: "medium",
      nextAction: "Run isolated workflow",
      nodeLabel: "1 task / 1 gate",
      updatedAt: "2026-06-06T09:05:00.000Z",
      workflowRunHref: "/workflows/workflow-123456789",
      workflowRunId: "workflow-123456789",
      workflowRunStatus: "ready",
      workflowRunStatusLabel: "Ready",
      availableActions: ["enqueue"]
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

  it("maps requirement tickets to lifecycle actions and current workflow evidence", () => {
    const requirement: RequirementDeliveryTicket = {
      id: "requirement-1",
      title: "Confirm checkout plan",
      repositoryPath: "C:/work/shop",
      goal: "Ship checkout evidence",
      acceptanceCriteria: ["Gate evidence is reviewable"],
      constraints: ["No MAWO auto-merge; manual git apply outside MAWO"],
      nonGoals: ["Automatic PR creation"],
      riskLevel: "medium",
      contextPaths: [],
      tasks: [
        {
          id: "task-1",
          title: "Patch checkout",
          agent: "shell",
          instructions: "Patch checkout"
        }
      ],
      qualityGates: [
        {
          id: "gate-1",
          title: "Unit tests",
          command: "npm test",
          required: true
        }
      ],
      status: "plan_review",
      runLinks: [],
      createdAt: "2026-06-06T11:00:00.000Z",
      updatedAt: "2026-06-06T11:05:00.000Z"
    };

    expect(mapRequirementTicketToSummary(requirement)).toMatchObject({
      id: "requirement-1",
      requirementStage: "plan_review",
      nextAction: "Confirm plan",
      repositorySafety: expect.objectContaining({
        allowedRootLabel: "Allowed root pending preflight",
        cleanStateLabel: "Clean state pending preflight"
      }),
      workflowRunStatusLabel: "No workflow run linked",
      availableActions: ["confirm-plan"]
    });

    expect(
      mapRequirementTicketToSummary(
        {
          ...requirement,
          status: "running",
          currentWorkflowRunId: "workflow-1",
          runLinks: [
            {
              workflowRunId: "workflow-1",
              status: "ready",
              linkedAt: "2026-06-06T11:06:00.000Z"
            }
          ]
        },
        new Map([[baseWorkflow.id, baseWorkflow]]),
        { jobStatusByRequirementId: { "requirement-1": "queued" } }
      )
    ).toMatchObject({
      currentJobStatus: "queued",
      requirementStage: "running",
      workflowRunHref: "/workflows/workflow-1",
      workflowRunId: "workflow-1",
      workflowRunStatus: "ready",
      workflowRunStatusLabel: "Ready"
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
      blockedReason:
        "Required gate failed; merge approval is blocked while evidence remains inspectable.",
      branchLabel: "mawo/workflow-123/task-1",
      cleanStateLabel: "Apply clean check required",
      executionModeLabel: "Isolated worktree",
      headLabel: "HEAD SHA not reported",
      mergePolicyLabel: "No MAWO auto-merge; manual git apply outside MAWO",
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
