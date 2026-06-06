import { describe, expect, it } from "vitest";
import type { WorkflowRun } from "@mawo/shared";
import {
  buildWorkflowListDisplay,
  summarizeWorkflowList
} from "./workflow-list-display";

const workflows: WorkflowRun[] = [
  {
    id: "workflow-123456789",
    goal: "Ship repository workflow",
    status: "needs_review",
    repositoryPath: "C:/work/repo",
    updatedAt: "2026-06-05T11:18:11.366Z",
    tasks: [
      {
        id: "task-1",
        title: "Implement",
        status: "passed"
      }
    ],
    qualityGates: [
      {
        id: "gate-1",
        title: "Tests",
        status: "passed",
        required: true
      }
    ]
  },
  {
    id: "workflow-abcdef123",
    goal: "Demo workflow",
    status: "failed",
    createdAt: "2026-06-05T11:17:11.366Z",
    tasks: [],
    qualityGates: []
  }
];

describe("workflow list display", () => {
  it("maps workflows to compact operator rows", () => {
    expect(buildWorkflowListDisplay(workflows)).toEqual([
      {
        id: "workflow-123456789",
        workflowLabel: "workflow-",
        goal: "Ship repository workflow",
        status: "needs_review",
        nodeLabel: "2 nodes",
        repositoryLabel: "C:/work/repo",
        updatedAt: "2026-06-05T11:18:11.366Z"
      },
      {
        id: "workflow-abcdef123",
        workflowLabel: "workflow-",
        goal: "Demo workflow",
        status: "failed",
        nodeLabel: "0 nodes",
        repositoryLabel: "No repository",
        updatedAt: "2026-06-05T11:17:11.366Z"
      }
    ]);
  });

  it("summarizes active and review-ready workflows", () => {
    expect(summarizeWorkflowList(workflows)).toEqual({
      total: 2,
      active: 0,
      needsReview: 1
    });
  });
});
