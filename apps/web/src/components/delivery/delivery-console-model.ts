import type { WorkflowRun } from "@mawo/shared";

export type RequirementStage =
  | "draft"
  | "needs_clarification"
  | "plan_review"
  | "ready_to_run"
  | "running"
  | "needs_review"
  | "delivered"
  | "needs_rework"
  | "archived";

export type RequirementRiskLevel = "low" | "medium" | "high";

export type RequirementSummary = {
  id: string;
  title: string;
  repositoryLabel: string;
  requirementStage: RequirementStage;
  executionStatus: WorkflowRun["status"];
  riskLevel: RequirementRiskLevel;
  nextAction: string;
  nodeLabel: string;
  updatedAt: string;
};

export type DeliveryDecisionSeverity = "info" | "warning" | "danger";

export type DeliveryDecisionItem = {
  id: string;
  requirementId: string;
  title: string;
  actionLabel: string;
  severity: DeliveryDecisionSeverity;
};

export type DeliveryConsoleKpis = {
  activeRequirements: number;
  needsClarification: number;
  runningTasks: number;
  failedGates: number;
  waitingForReview: number;
  deliveredLastSevenDays: number;
};

export type DeliveryConsoleModel = {
  requirements: RequirementSummary[];
  kpis: DeliveryConsoleKpis;
  decisionQueue: DeliveryDecisionItem[];
};

const statusStageMap: Record<WorkflowRun["status"], RequirementStage> = {
  draft: "draft",
  ready: "ready_to_run",
  running: "running",
  gate_failed: "needs_rework",
  needs_review: "needs_review",
  completed: "delivered",
  aborted: "needs_rework",
  archived: "archived",
  failed: "needs_rework"
};

function buildNodeLabel(workflow: WorkflowRun): string {
  const taskCount = workflow.tasks.length;
  const gateCount = workflow.qualityGates.length;
  const taskLabel = `${taskCount} ${taskCount === 1 ? "task" : "tasks"}`;
  const gateLabel = `${gateCount} ${gateCount === 1 ? "gate" : "gates"}`;

  return `${taskLabel} / ${gateLabel}`;
}

function mapRiskLevel(workflow: WorkflowRun): RequirementRiskLevel {
  if (workflow.status === "gate_failed" || workflow.status === "failed") {
    return "high";
  }

  if (workflow.status === "completed" && workflow.review?.decision === "approved") {
    return "low";
  }

  return "medium";
}

function mapNextAction(workflow: WorkflowRun): string {
  switch (workflow.status) {
    case "draft":
      return "Complete requirement";
    case "ready":
      return "Run isolated workflow";
    case "running":
      return "View execution";
    case "gate_failed":
      return "Retry failed gate";
    case "needs_review":
      return "Review merge candidate";
    case "completed":
      return "Review delivered evidence";
    case "aborted":
      return "Retry canceled workflow";
    case "failed":
      return "Retry failed workflow";
    case "archived":
      return "View archived evidence";
  }
}

export function mapWorkflowToRequirementSummary(
  workflow: WorkflowRun
): RequirementSummary {
  return {
    id: workflow.id,
    title: workflow.goal,
    repositoryLabel: workflow.repositoryPath ?? "No repository selected",
    requirementStage: statusStageMap[workflow.status],
    executionStatus: workflow.status,
    riskLevel: mapRiskLevel(workflow),
    nextAction: mapNextAction(workflow),
    nodeLabel: buildNodeLabel(workflow),
    updatedAt: workflow.updatedAt ?? workflow.createdAt ?? "Unknown"
  };
}

function buildDecisionQueue(workflows: WorkflowRun[]): DeliveryDecisionItem[] {
  return workflows.flatMap((workflow): DeliveryDecisionItem[] => {
    if (workflow.status === "gate_failed") {
      return [
        {
          id: `${workflow.id}:retry`,
          requirementId: workflow.id,
          title: workflow.goal,
          actionLabel: "Retry failed gate",
          severity: "danger"
        }
      ];
    }

    if (workflow.status === "needs_review") {
      return [
        {
          id: `${workflow.id}:review`,
          requirementId: workflow.id,
          title: workflow.goal,
          actionLabel: "Review merge candidate",
          severity: "warning"
        }
      ];
    }

    return [];
  });
}

export function buildDeliveryConsoleModel(
  workflows: WorkflowRun[]
): DeliveryConsoleModel {
  const requirements = workflows.map(mapWorkflowToRequirementSummary);

  return {
    requirements,
    kpis: {
      activeRequirements: requirements.filter(
        (requirement) => requirement.requirementStage !== "archived"
      ).length,
      needsClarification: requirements.filter(
        (requirement) => requirement.requirementStage === "needs_clarification"
      ).length,
      runningTasks: workflows.filter((workflow) => workflow.status === "running")
        .length,
      failedGates: workflows.filter((workflow) => workflow.status === "gate_failed")
        .length,
      waitingForReview: workflows.filter(
        (workflow) => workflow.status === "needs_review"
      ).length,
      deliveredLastSevenDays: workflows.filter(
        (workflow) =>
          workflow.status === "completed" &&
          workflow.review?.decision === "approved"
      ).length
    },
    decisionQueue: buildDecisionQueue(workflows)
  };
}
