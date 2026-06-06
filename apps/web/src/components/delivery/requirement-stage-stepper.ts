import type { RequirementStage } from "./delivery-console-model";

export type RequirementStageStepState =
  | "complete"
  | "active"
  | "upcoming"
  | "failed";

export type RequirementStageStep = {
  id: "draft" | "clarify" | "plan" | "run" | "gates" | "review" | "delivered";
  label: string;
  state: RequirementStageStepState;
  reason?: string;
};

const steps: Array<Pick<RequirementStageStep, "id" | "label">> = [
  { id: "draft", label: "Draft" },
  { id: "clarify", label: "Clarify" },
  { id: "plan", label: "Plan" },
  { id: "run", label: "Run" },
  { id: "gates", label: "Gates" },
  { id: "review", label: "Review" },
  { id: "delivered", label: "Delivered" }
];

const activeStepIndex: Record<RequirementStage, number> = {
  draft: 0,
  needs_clarification: 1,
  plan_review: 2,
  ready_to_run: 3,
  running: 3,
  needs_review: 5,
  delivered: 6,
  needs_rework: 4,
  archived: 6
};

export function buildRequirementStageStepper(
  stage: RequirementStage
): RequirementStageStep[] {
  const activeIndex = activeStepIndex[stage];

  return steps.map((step, index) => {
    if (stage === "needs_rework" && step.id === "gates") {
      return {
        ...step,
        state: "failed",
        reason: "Merge approval blocked"
      };
    }

    if (stage === "delivered" || stage === "archived") {
      return {
        ...step,
        state: "complete"
      };
    }

    if (index < activeIndex) {
      return {
        ...step,
        state: "complete"
      };
    }

    if (index === activeIndex) {
      return {
        ...step,
        state: "active"
      };
    }

    return {
      ...step,
      state: "upcoming"
    };
  });
}
