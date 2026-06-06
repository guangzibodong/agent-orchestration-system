import { describe, expect, it } from "vitest";
import { buildRequirementStageStepper } from "./requirement-stage-stepper";

describe("requirement stage stepper", () => {
  it("keeps the frozen delivery stages in user-facing order", () => {
    expect(buildRequirementStageStepper("ready_to_run")).toEqual([
      { id: "draft", label: "Draft", state: "complete" },
      { id: "clarify", label: "Clarify", state: "complete" },
      { id: "plan", label: "Plan", state: "complete" },
      { id: "run", label: "Run", state: "active" },
      { id: "gates", label: "Gates", state: "upcoming" },
      { id: "review", label: "Review", state: "upcoming" },
      { id: "delivered", label: "Delivered", state: "upcoming" }
    ]);
  });

  it("marks required gate failure as a blocked gates step", () => {
    expect(buildRequirementStageStepper("needs_rework")).toEqual([
      { id: "draft", label: "Draft", state: "complete" },
      { id: "clarify", label: "Clarify", state: "complete" },
      { id: "plan", label: "Plan", state: "complete" },
      { id: "run", label: "Run", state: "complete" },
      {
        id: "gates",
        label: "Gates",
        state: "failed",
        reason: "Merge-ready conclusion blocked"
      },
      { id: "review", label: "Review", state: "upcoming" },
      { id: "delivered", label: "Delivered", state: "upcoming" }
    ]);
  });
});
