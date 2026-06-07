import type {
  DeliveryDecisionItem,
  DeliveryDecisionSeverity,
  RequirementLifecycleAction,
  RequirementRiskLevel,
  RequirementStage,
  RequirementSummary
} from "./delivery-console-model";

export type RequirementQueueRow = {
  id: string;
  title: string;
  repositoryLabel: string;
  repositoryFullLabel?: string;
  stageLabel: string;
  riskLabel: string;
  nextAction: string;
  nodeLabel: string;
  updatedAt: string;
  availableActions: RequirementLifecycleAction[];
  actionBlockReason?: string;
  currentJobStatusLabel?: string;
  workflowRunHref?: string;
  workflowRunId?: string;
  workflowRunStatusLabel: string;
};

export type DecisionQueueDisplayItem = {
  id: string;
  requirementId: string;
  title: string;
  actionLabel: string;
  severityLabel: string;
  tone: DeliveryDecisionSeverity;
};

const stageLabels: Record<RequirementStage, string> = {
  draft: "Draft",
  needs_clarification: "Needs clarification",
  plan_review: "Plan review",
  ready_to_run: "Ready to run",
  running: "Running",
  needs_review: "Needs review",
  delivered: "Delivered",
  needs_rework: "Needs rework",
  archived: "Archived"
};

const riskLabels: Record<RequirementRiskLevel, string> = {
  low: "Low risk",
  medium: "Medium risk",
  high: "High risk"
};

const jobStatusLabels = {
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  canceled: "Canceled"
} as const;

const severityLabels: Record<DeliveryDecisionSeverity, string> = {
  info: "Info",
  warning: "Needs review",
  danger: "Blocking"
};

export function buildRequirementQueueRows(
  requirements: RequirementSummary[]
): RequirementQueueRow[] {
  return requirements.map((requirement) => {
    const repositoryLabel = compactRepositoryLabel(requirement.repositoryLabel);

    return {
      id: requirement.id,
      title: requirement.title,
      repositoryLabel,
      ...(repositoryLabel !== requirement.repositoryLabel
        ? { repositoryFullLabel: requirement.repositoryLabel }
        : {}),
      stageLabel: stageLabels[requirement.requirementStage],
      riskLabel: riskLabels[requirement.riskLevel],
      nextAction: requirement.nextAction,
      nodeLabel: requirement.nodeLabel,
      updatedAt: requirement.updatedAt,
      availableActions: requirement.availableActions,
      ...(requirement.actionBlockReason
        ? { actionBlockReason: requirement.actionBlockReason }
        : {}),
      currentJobStatusLabel: requirement.currentJobStatus
        ? jobStatusLabels[requirement.currentJobStatus]
        : undefined,
      workflowRunHref: requirement.workflowRunHref,
      workflowRunId: requirement.workflowRunId,
      workflowRunStatusLabel: requirement.workflowRunStatusLabel
    };
  });
}

function compactRepositoryLabel(label: string): string {
  const normalizedPath = label.replace(/\\/g, "/");
  const segments = normalizedPath.split("/").filter(Boolean);
  const workRootIndex = segments.indexOf("work");

  if (label.length <= 36 || segments.length <= 3) {
    return label;
  }

  if (workRootIndex >= 0 && workRootIndex < segments.length - 1) {
    return `.../${segments.slice(workRootIndex + 1).join("/")}`;
  }

  return `.../${segments.slice(-3).join("/")}`;
}

export function buildDecisionQueueDisplay(
  decisions: DeliveryDecisionItem[]
): DecisionQueueDisplayItem[] {
  return decisions.map((decision) => ({
    id: decision.id,
    requirementId: decision.requirementId,
    title: decision.title,
    actionLabel: decision.actionLabel,
    severityLabel: severityLabels[decision.severity],
    tone: decision.severity
  }));
}
