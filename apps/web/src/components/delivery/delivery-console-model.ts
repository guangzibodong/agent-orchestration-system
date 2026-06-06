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

export type RepositorySafetySummary = {
  repositoryLabel: string;
  executionModeLabel: string;
  branchLabel: string;
  headLabel: string;
  cleanStateLabel: string;
  allowedRootLabel: string;
  mergePolicyLabel: string;
  blockedReason?: string;
  recoveryAction: string;
};

export type RequirementSummary = {
  id: string;
  title: string;
  repositoryLabel: string;
  repositorySafety: RepositorySafetySummary;
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

function buildRepositorySafety(workflow: WorkflowRun): RepositorySafetySummary {
  const latestWorkspace = [...workflow.tasks]
    .reverse()
    .find((task) => task.workspace)?.workspace;
  const hasRepository = Boolean(workflow.repositoryPath);
  const blockedReason = buildRepositoryBlockedReason(workflow, hasRepository);

  return {
    repositoryLabel: workflow.repositoryPath ?? "No repository selected",
    executionModeLabel:
      workflow.executionMode === "worktree" || latestWorkspace
        ? "Isolated worktree"
        : "Direct repository",
    branchLabel: latestWorkspace?.branch ?? "Branch pending preflight",
    headLabel: "HEAD SHA not reported",
    cleanStateLabel: hasRepository
      ? workflow.status === "needs_review" ||
        workflow.status === "completed" ||
        workflow.status === "gate_failed"
        ? "Apply clean check required"
        : "Clean state pending preflight"
      : "No repository selected",
    allowedRootLabel: hasRepository
      ? "Allowed root accepted by API"
      : "Allowed root not checked",
    mergePolicyLabel: "Manual git apply only",
    blockedReason,
    recoveryAction: buildRepositoryRecoveryAction(workflow, hasRepository)
  };
}

function buildRepositoryBlockedReason(
  workflow: WorkflowRun,
  hasRepository: boolean
): string | undefined {
  if (!hasRepository) {
    return "Repository path required before execution.";
  }

  if (workflow.status === "gate_failed") {
    return "Required gate failed; merge-ready conclusion is blocked.";
  }

  if (workflow.status === "failed") {
    return "Workflow failed before merge-ready evidence was produced.";
  }

  if (workflow.status === "aborted") {
    return "Workflow was canceled before delivery evidence was complete.";
  }

  return undefined;
}

function buildRepositoryRecoveryAction(
  workflow: WorkflowRun,
  hasRepository: boolean
): string {
  if (!hasRepository) {
    return "Register or select a repository";
  }

  if (workflow.status === "gate_failed") {
    return "Retry failed gate";
  }

  if (workflow.status === "failed" || workflow.status === "aborted") {
    return "Retry workflow";
  }

  return "Run repository preflight before mutating actions";
}

export function mapWorkflowToRequirementSummary(
  workflow: WorkflowRun
): RequirementSummary {
  return {
    id: workflow.id,
    title: workflow.goal,
    repositoryLabel: workflow.repositoryPath ?? "No repository selected",
    repositorySafety: buildRepositorySafety(workflow),
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
  workflows: WorkflowRun[],
  now: Date = new Date()
): DeliveryConsoleModel {
  const requirements = workflows.map(mapWorkflowToRequirementSummary);
  const sevenDaysAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;

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
          workflow.review?.decision === "approved" &&
          updatedAtMs(workflow) >= sevenDaysAgo &&
          updatedAtMs(workflow) <= now.getTime()
      ).length
    },
    decisionQueue: buildDecisionQueue(workflows)
  };
}

function updatedAtMs(workflow: WorkflowRun): number {
  const value = workflow.updatedAt ?? workflow.createdAt;

  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}
