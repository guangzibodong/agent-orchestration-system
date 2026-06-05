import { describe, expect, it } from "vitest";
import type { WorkflowRun } from "@mawo/shared";
import {
  cleanupWorkflowWorkspacesWithResult,
  buildWorkspaceCleanupPreviewDisplay,
  cleanupWorkflowWorkspaces,
  loadWorkflowWorkspacePreview
} from "./workflow-workspaces";

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
      if (path.endsWith("/cleanup")) {
        return {
          workflowId: "workflow-1",
          status: "cleaned",
          cleanedAt: "2026-06-05T00:00:00.000Z",
          cleaned: [
            {
              taskId: "task-1",
              path: "C:/tmp/mawo/worktrees/workflow-1/task-1",
              branch: "mawo/workflow-1/task-1"
            }
          ]
        };
      }

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

  it("keeps the structured cleanup result when refreshing a workflow", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    const result = await cleanupWorkflowWorkspacesWithResult(
      async (path, init) => {
        requests.push({ path, init });
        if (path.endsWith("/cleanup")) {
          return {
            workflowId: "workflow-1",
            status: "cleaned",
            cleanedAt: "2026-06-05T00:00:00.000Z",
            cleaned: [
              {
                taskId: "task-1",
                path: "C:/tmp/mawo/worktrees/workflow-1/task-1",
                branch: "mawo/workflow-1/task-1"
              }
            ]
          };
        }

        return {
          ...completedWorkflow,
          tasks: completedWorkflow.tasks.map((task) => ({
            ...task,
            workspace: undefined
          }))
        };
      },
      completedWorkflow
    );

    expect(requests.map((request) => request.path)).toEqual([
      "/workflows/workflow-1/workspaces/cleanup",
      "/workflows/workflow-1"
    ]);
    expect(result.cleanup).toMatchObject({
      status: "cleaned",
      cleaned: [
        {
          taskId: "task-1",
          branch: "mawo/workflow-1/task-1"
        }
      ]
    });
    expect(result.workflow.tasks[0]?.workspace).toBeUndefined();
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

  it("loads and summarizes workspace cleanup preview state", async () => {
    const requests: string[] = [];
    const preview = await loadWorkflowWorkspacePreview(
      async (path) => {
        requests.push(path);
        return {
          workflowId: "workflow-1",
          workflowStatus: "completed",
          cleanupAllowed: true,
          workspaceCount: 1,
          existingCount: 1,
          workspaces: [
            {
              taskId: "task-1",
              taskTitle: "Implement",
              path: "C:/tmp/mawo/worktrees/workflow-1/task-1",
              branch: "mawo/workflow-1/task-1",
              repoPath: "C:/repo",
              exists: true,
              cleanupAllowed: true
            }
          ]
        };
      },
      "workflow-1"
    );
    const display = buildWorkspaceCleanupPreviewDisplay(preview);

    expect(requests).toEqual(["/workflows/workflow-1/workspaces"]);
    expect(display).toEqual({
      statusLabel: "Cleanup ready",
      summary: "1 tracked workspace, 1 still on disk",
      blockedReason: undefined,
      rows: [
        {
          task: "Implement",
          branch: "mawo/workflow-1/task-1",
          path: "C:/tmp/mawo/worktrees/workflow-1/task-1",
          status: "Present"
        }
      ]
    });
  });

  it("summarizes empty cleanup previews as no active targets", () => {
    expect(
      buildWorkspaceCleanupPreviewDisplay({
        workflowId: "workflow-1",
        workflowStatus: "completed",
        cleanupAllowed: true,
        workspaceCount: 0,
        existingCount: 0,
        workspaces: []
      })
    ).toMatchObject({
      statusLabel: "No cleanup targets",
      summary: "0 tracked workspaces, 0 still on disk",
      rows: []
    });
  });
});
