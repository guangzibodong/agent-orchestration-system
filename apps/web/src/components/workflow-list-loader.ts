import { workflowRunSchema, type WorkflowRun } from "@mawo/shared";

type ApiClient = (path: string, init?: RequestInit) => Promise<unknown>;

export type WorkflowListOptions = {
  repositoryId?: string;
};

export async function loadWorkflowRuns(
  api: ApiClient,
  options: WorkflowListOptions = {}
): Promise<WorkflowRun[]> {
  const workflows = await api(buildWorkflowListPath(options));
  return workflowRunSchema.array().parse(workflows);
}

export function buildWorkflowListPath(
  options: WorkflowListOptions = {}
): string {
  const repositoryId = options.repositoryId?.trim();

  if (!repositoryId) {
    return "/workflows";
  }

  const params = new URLSearchParams({ repositoryId });
  return `/workflows?${params.toString()}`;
}
