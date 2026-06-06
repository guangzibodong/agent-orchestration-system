import type {
  DeliveryDecisionItem,
  DeliveryDecisionSeverity,
  RequirementRiskLevel,
  RequirementStage,
  RequirementSummary
} from "./delivery-console-model";

export type RequirementQueueRow = {
  id: string;
  title: string;
  repositoryLabel: string;
  stageLabel: string;
  riskLabel: string;
  nextAction: string;
  nodeLabel: string;
  updatedAt: string;
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

const severityLabels: Record<DeliveryDecisionSeverity, string> = {
  info: "Info",
  warning: "Needs review",
  danger: "Blocking"
};

export function buildRequirementQueueRows(
  requirements: RequirementSummary[]
): RequirementQueueRow[] {
  return requirements.map((requirement) => ({
    id: requirement.id,
    title: requirement.title,
    repositoryLabel: requirement.repositoryLabel,
    stageLabel: stageLabels[requirement.requirementStage],
    riskLabel: riskLabels[requirement.riskLevel],
    nextAction: requirement.nextAction,
    nodeLabel: requirement.nodeLabel,
    updatedAt: requirement.updatedAt
  }));
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
