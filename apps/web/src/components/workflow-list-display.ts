import type { WorkflowRun } from "@mawo/shared";

export type WorkflowListDisplay = {
  id: string;
  workflowLabel: string;
  goal: string;
  status: WorkflowRun["status"];
  nodeLabel: string;
  repositoryLabel: string;
  updatedAt: string;
};

export function buildWorkflowListDisplay(
  workflows: WorkflowRun[]
): WorkflowListDisplay[] {
  return workflows.map((workflow) => {
    const nodeCount = workflow.tasks.length + workflow.qualityGates.length;

    return {
      id: workflow.id,
      workflowLabel: workflow.id.slice(0, 9),
      goal: workflow.goal,
      status: workflow.status,
      nodeLabel: `${nodeCount} ${nodeCount === 1 ? "node" : "nodes"}`,
      repositoryLabel: workflow.repositoryPath ?? "No repository",
      updatedAt: workflow.updatedAt ?? workflow.createdAt ?? "Unknown"
    };
  });
}

export function summarizeWorkflowList(workflows: WorkflowRun[]): {
  total: number;
  active: number;
  needsReview: number;
} {
  return {
    total: workflows.length,
    active: workflows.filter(
      (workflow) => workflow.status === "running" || workflow.status === "ready"
    ).length,
    needsReview: workflows.filter((workflow) => workflow.status === "needs_review")
      .length
  };
}
