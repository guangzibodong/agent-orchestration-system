import { describe, expect, it } from "vitest";
import { loadRequirementDeliveryModel } from "./requirement-delivery-loader";

describe("requirement delivery loader", () => {
  it("loads workflow runs through the existing workflow API contract", async () => {
    const requests: string[] = [];

    const model = await loadRequirementDeliveryModel(async (path) => {
      requests.push(path);
      return [
        {
          id: "workflow-review",
          goal: "Review checkout patch",
          repositoryPath: "C:/work/shop",
          status: "needs_review",
          updatedAt: "2026-06-06T11:05:00.000Z",
          tasks: [{ id: "task-1", title: "Patch checkout", status: "passed" }],
          qualityGates: [
            { id: "gate-1", title: "Unit tests", status: "passed" }
          ]
        }
      ];
    });

    expect(requests).toEqual(["/workflows"]);
    expect(model.requirements).toHaveLength(1);
    expect(model.requirements[0]).toMatchObject({
      id: "workflow-review",
      title: "Review checkout patch",
      requirementStage: "needs_review",
      nextAction: "Review merge candidate"
    });
    expect(model.decisionQueue[0]).toMatchObject({
      requirementId: "workflow-review",
      actionLabel: "Review merge candidate"
    });
  });
});
