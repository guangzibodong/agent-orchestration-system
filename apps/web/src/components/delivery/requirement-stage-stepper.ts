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

export type RequirementStageStepperOptions = {
  blockKind?: "agent-availability" | "repository-safety";
  blockActionLabel?: string;
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
  stage: RequirementStage,
  options: RequirementStageStepperOptions = {}
): RequirementStageStep[] {
  const activeIndex = activeStepIndex[stage];

  return steps.map((step, index) => {
    if (
      step.id === "run" &&
      (stage === "ready_to_run" || stage === "running") &&
      options.blockKind
    ) {
      return {
        ...step,
        state: "failed",
        reason: `Preflight blocked${
          options.blockActionLabel ? `: ${options.blockActionLabel}` : ""
        }`
      };
    }

    if (stage === "needs_rework" && step.id === "gates") {
      return {
        ...step,
        state: "failed",
        reason: "Merge approval blocked"
      };
    }

    if (stage === "delivered") {
      return {
        ...step,
        state: "complete"
      };
    }

    if (stage === "archived" && step.id === "delivered") {
      return {
        ...step,
        state: "upcoming",
        reason: "Archived without active delivery"
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
