import { describe, expect, it } from "vitest";
import { loadWorkflowRuns } from "./workflow-list-loader";

describe("workflow list loader", () => {
  it("loads all workflows when no repository scope is selected", async () => {
    const requests: string[] = [];

    const workflows = await loadWorkflowRuns(async (path) => {
      requests.push(path);
      return [
        {
          id: "workflow-1",
          goal: "Ship",
          status: "ready",
          tasks: [],
          qualityGates: []
        }
      ];
    });

    expect(requests).toEqual(["/workflows"]);
    expect(workflows[0]?.id).toBe("workflow-1");
  });

  it("loads workflows for the selected repository scope", async () => {
    const requests: string[] = [];

    await loadWorkflowRuns(
      async (path) => {
        requests.push(path);
        return [];
      },
      { repositoryId: "repo 1" }
    );

    expect(requests).toEqual(["/workflows?repositoryId=repo+1"]);
  });
});
