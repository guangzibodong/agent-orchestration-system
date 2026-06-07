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
        reason: "Merge approval blocked"
      },
      { id: "review", label: "Review", state: "upcoming" },
      { id: "delivered", label: "Delivered", state: "upcoming" }
    ]);
  });

  it("marks preflight-blocked ready requirements on the run step", () => {
    expect(
      buildRequirementStageStepper("ready_to_run", {
        blockKind: "agent-availability",
        blockActionLabel: "Configure missing agent"
      })
    ).toEqual([
      { id: "draft", label: "Draft", state: "complete" },
      { id: "clarify", label: "Clarify", state: "complete" },
      { id: "plan", label: "Plan", state: "complete" },
      {
        id: "run",
        label: "Run",
        state: "failed",
        reason: "Preflight blocked: Configure missing agent"
      },
      { id: "gates", label: "Gates", state: "upcoming" },
      { id: "review", label: "Review", state: "upcoming" },
      { id: "delivered", label: "Delivered", state: "upcoming" }
    ]);
  });

  it("keeps archived requirements distinct from delivered requirements", () => {
    expect(buildRequirementStageStepper("archived")).toEqual([
      { id: "draft", label: "Draft", state: "complete" },
      { id: "clarify", label: "Clarify", state: "complete" },
      { id: "plan", label: "Plan", state: "complete" },
      { id: "run", label: "Run", state: "complete" },
      { id: "gates", label: "Gates", state: "complete" },
      { id: "review", label: "Review", state: "complete" },
      {
        id: "delivered",
        label: "Delivered",
        state: "upcoming",
        reason: "Archived without active delivery"
      }
    ]);
  });
});
