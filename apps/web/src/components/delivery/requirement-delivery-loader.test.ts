import { describe, expect, it } from "vitest";
import { loadRequirementDeliveryModel } from "./requirement-delivery-loader";

describe("requirement delivery loader", () => {
  it("loads workflow runs through the existing workflow API contract", async () => {
    const requests: string[] = [];

    const model = await loadRequirementDeliveryModel(async (path) => {
      requests.push(path);
      if (path === "/requirements") {
        return [];
      }

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

    expect(requests).toEqual(["/workflows", "/requirements"]);
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

  it("uses requirement tickets as the primary console objects when available", async () => {
    const model = await loadRequirementDeliveryModel(async (path) => {
      if (path === "/workflows") {
        return [
          {
            id: "workflow-linked",
            goal: "Workflow evidence",
            repositoryPath: "C:/work/shop",
            status: "ready",
            updatedAt: "2026-06-06T11:04:00.000Z",
            tasks: [{ id: "task-1", title: "Patch", status: "waiting" }],
            qualityGates: [
              { id: "gate-1", title: "Unit tests", status: "waiting" }
            ]
          }
        ];
      }

      return [
        {
          id: "requirement-linked",
          title: "Run checkout ticket",
          repositoryPath: "C:/work/shop",
          goal: "Run checkout evidence",
          acceptanceCriteria: ["Evidence is reviewable"],
          constraints: ["Manual git apply only"],
          nonGoals: ["Automatic PR creation"],
          riskLevel: "medium",
          contextPaths: [],
          tasks: [
            {
              id: "task-1",
              title: "Patch",
              agent: "shell",
              instructions: "Patch"
            }
          ],
          qualityGates: [
            {
              id: "gate-1",
              title: "Unit tests",
              command: "npm test",
              required: true
            }
          ],
          status: "ready_to_run",
          currentWorkflowRunId: "workflow-linked",
          runLinks: [
            {
              workflowRunId: "workflow-linked",
              status: "ready",
              linkedAt: "2026-06-06T11:05:00.000Z"
            }
          ],
          createdAt: "2026-06-06T11:00:00.000Z",
          updatedAt: "2026-06-06T11:05:00.000Z"
        }
      ];
    });

    expect(model.requirements).toHaveLength(1);
    expect(model.requirements[0]).toMatchObject({
      id: "requirement-linked",
      nextAction: "Enqueue",
      workflowRunId: "workflow-linked",
      workflowRunStatusLabel: "Ready",
      availableActions: ["enqueue"]
    });
  });
});
