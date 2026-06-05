import {
  createRepositoryWorkflowRequestSchema,
  type CreateRepositoryWorkflowRequest
} from "@mawo/shared";

export type RepositoryWorkflowFormState = {
  goal: string;
  repositoryPath: string;
  agent: string;
  taskCommand: string;
  taskTimeoutMs: string;
  qualityGateCommand: string;
  qualityGateTimeoutMs: string;
};

export function buildRepositoryWorkflowPayload(
  state: RepositoryWorkflowFormState
): CreateRepositoryWorkflowRequest {
  const qualityGateCommand = state.qualityGateCommand.trim();
  const taskTimeoutMs = parseOptionalPositiveInteger(state.taskTimeoutMs);
  const qualityGateTimeoutMs = parseOptionalPositiveInteger(
    state.qualityGateTimeoutMs
  );

  return createRepositoryWorkflowRequestSchema.parse({
    goal: state.goal.trim(),
    repositoryPath: state.repositoryPath.trim(),
    tasks: [
      {
        id: "repository-task",
        title: "Repository task",
        agent: state.agent.trim(),
        command: state.taskCommand.trim(),
        timeoutMs: taskTimeoutMs
      }
    ],
    qualityGates: qualityGateCommand
      ? [
          {
            id: "quality-gate",
            title: "Quality gate",
            command: qualityGateCommand,
            timeoutMs: qualityGateTimeoutMs
          }
        ]
      : []
  });
}

export function canCreateRepositoryWorkflow(
  state: RepositoryWorkflowFormState
): boolean {
  try {
    buildRepositoryWorkflowPayload(state);
    return true;
  } catch {
    return false;
  }
}

function parseOptionalPositiveInteger(value: string): number | undefined {
  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  const parsed = Number(trimmed);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : Number.NaN;
}
