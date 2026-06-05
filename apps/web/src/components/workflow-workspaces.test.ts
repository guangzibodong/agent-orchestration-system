import { describe, expect, it } from "vitest";
import type { WorkflowRun } from "@mawo/shared";
import { cleanupWorkflowWorkspaces } from "./workflow-workspaces";

const completedWorkflow: WorkflowRun = {
  id: "workflow-1",
  goal: "Clean repository workspaces",
  status: "completed",
  tasks: [
    {
      id: "task-1",
      title: "Implement",
      status: "passed",
      workspace: {
        path: "C:/tmp/mawo/worktrees/workflow-1/task-1",
        branch: "mawo/workflow-1/task-1",
        repoPath: "C:/repo"
      }
    }
  ],
  qualityGates: []
};

describe("workflow workspace cleanup", () => {
  it("cleans workspaces and refreshes the workflow from the API", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    const api = async (path: string, init?: RequestInit): Promise<unknown> => {
      requests.push({ path, init });
      return {
        ...completedWorkflow,
        tasks: completedWorkflow.tasks.map((task) => ({
          ...task,
          workspace: undefined
        }))
      };
    };

    const refreshed = await cleanupWorkflowWorkspaces(api, completedWorkflow);

    expect(requests).toEqual([
      {
        path: "/workflows/workflow-1/workspaces/cleanup",
        init: {
          method: "POST",
          body: "{}"
        }
      },
      {
        path: "/workflows/workflow-1",
        init: undefined
      }
    ]);
    expect(refreshed.tasks[0]?.workspace).toBeUndefined();
  });

  it("does not call the API for workflows that are not cleanable", async () => {
    const requests: string[] = [];

    const refreshed = await cleanupWorkflowWorkspaces(
      async (path) => {
        requests.push(path);
        return completedWorkflow;
      },
      {
        ...completedWorkflow,
        status: "needs_review"
      }
    );

    expect(requests).toEqual([]);
    expect(refreshed.status).toBe("needs_review");
  });
});
