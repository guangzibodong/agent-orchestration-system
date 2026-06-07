import { describe, expect, it } from "vitest";
import type {
  RepositorySafetySummary,
  RequirementSummary
} from "./delivery-console-model";
import {
  buildDecisionQueueDisplay,
  buildRequirementQueueRows
} from "./requirement-queue-display";

const requirements: RequirementSummary[] = [
  {
    id: "req-1",
    title: "Fix checkout test flake",
    repositoryLabel: "C:/work/shop",
    repositorySafety: safety("C:/work/shop"),
    requirementStage: "ready_to_run",
    executionStatus: "ready",
    riskLevel: "medium",
    nextAction: "Run isolated workflow",
    nodeLabel: "1 task / 1 gate",
    updatedAt: "2026-06-06T09:05:00.000Z",
    workflowRunHref: "/workflows/workflow-ready",
    workflowRunId: "workflow-ready",
    workflowRunStatus: "ready",
    workflowRunStatusLabel: "Ready",
    availableActions: ["enqueue"]
  },
  {
    id: "req-2",
    title: "Harden auth checks",
    repositoryLabel: "C:/work/api",
    repositorySafety: safety("C:/work/api"),
    requirementStage: "needs_rework",
    executionStatus: "gate_failed",
    riskLevel: "high",
    nextAction: "Retry failed gate",
    nodeLabel: "2 tasks / 1 gate",
    updatedAt: "2026-06-06T10:05:00.000Z",
    currentJobStatus: "failed",
    workflowRunHref: "/workflows/workflow-failed",
    workflowRunId: "workflow-failed",
    workflowRunStatus: "gate_failed",
    workflowRunStatusLabel: "Gate failed",
    availableActions: ["retry"]
  }
];

function safety(repositoryLabel: string): RepositorySafetySummary {
  return {
    allowedRootLabel: "Allowed root accepted by API",
    branchLabel: "Branch pending preflight",
    cleanStateLabel: "Clean state pending preflight",
    executionModeLabel: "Direct repository",
    headLabel: "HEAD SHA not reported",
    mergePolicyLabel: "No MAWO auto-merge; manual git apply outside MAWO",
    recoveryAction: "Run repository preflight before mutating actions",
    repositoryLabel
  };
}

describe("requirement queue display", () => {
  it("formats requirement rows without exposing raw workflow-first labels", () => {
    expect(buildRequirementQueueRows(requirements)).toEqual([
      {
        id: "req-1",
        title: "Fix checkout test flake",
        repositoryLabel: "C:/work/shop",
        stageLabel: "Ready to run",
        riskLabel: "Medium risk",
        nextAction: "Run isolated workflow",
        nodeLabel: "1 task / 1 gate",
        updatedAt: "2026-06-06T09:05:00.000Z",
        availableActions: ["enqueue"],
        currentJobStatusLabel: undefined,
        workflowRunHref: "/workflows/workflow-ready",
        workflowRunId: "workflow-ready",
        workflowRunStatusLabel: "Ready"
      },
      {
        id: "req-2",
        title: "Harden auth checks",
        repositoryLabel: "C:/work/api",
        stageLabel: "Needs rework",
        riskLabel: "High risk",
        nextAction: "Retry failed gate",
        nodeLabel: "2 tasks / 1 gate",
        updatedAt: "2026-06-06T10:05:00.000Z",
        availableActions: ["retry"],
        currentJobStatusLabel: "Failed",
        workflowRunHref: "/workflows/workflow-failed",
        workflowRunId: "workflow-failed",
        workflowRunStatusLabel: "Gate failed"
      }
    ]);
  });

  it("formats decision items as user actions instead of logs", () => {
    expect(
      buildDecisionQueueDisplay([
        {
          id: "req-2:retry",
          requirementId: "req-2",
          title: "Harden auth checks",
          actionLabel: "Retry failed gate",
          severity: "danger"
        }
      ])
    ).toEqual([
      {
        id: "req-2:retry",
        requirementId: "req-2",
        title: "Harden auth checks",
        actionLabel: "Retry failed gate",
        severityLabel: "Blocking",
        tone: "danger"
      }
    ]);
  });

  it("compacts long repository paths while preserving the full queue label", () => {
    const [row] = buildRequirementQueueRows([
      {
        ...requirements[0],
        repositoryLabel:
          "C:/work/safety-console/checkout-with-a-very-long-repository-label",
        repositorySafety: safety(
          "C:/work/safety-console/checkout-with-a-very-long-repository-label"
        )
      }
    ]);

    expect(row?.repositoryLabel).toBe(
      ".../safety-console/checkout-with-a-very-long-repository-label"
    );
    expect(row?.repositoryFullLabel).toBe(
      "C:/work/safety-console/checkout-with-a-very-long-repository-label"
    );
  });
});
