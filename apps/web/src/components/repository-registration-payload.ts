import {
  repositoryRegistrationRequestSchema,
  type RepositoryRegistrationRequest
} from "@mawo/shared";

export type RepositoryRegistrationFormState = {
  name: string;
  path: string;
  defaultBranch: string;
  qualityGateCommand: string;
  qualityGateTimeoutMs: string;
};

export function buildRepositoryRegistrationPayload(
  state: RepositoryRegistrationFormState
): RepositoryRegistrationRequest {
  const defaultBranch = state.defaultBranch.trim();
  const qualityGateCommand = state.qualityGateCommand.trim();
  const qualityGateTimeoutMs = parseOptionalPositiveInteger(
    state.qualityGateTimeoutMs
  );

  return repositoryRegistrationRequestSchema.parse({
    name: state.name.trim(),
    path: state.path.trim(),
    defaultBranch: defaultBranch || undefined,
    qualityGates: qualityGateCommand
      ? [
          {
            id: "registration-quality-gate",
            title: "Registration quality gate",
            command: qualityGateCommand,
            timeoutMs: qualityGateTimeoutMs
          }
        ]
      : []
  });
}

export function canRegisterRepository(
  state: RepositoryRegistrationFormState
): boolean {
  if (!state.name.trim() || !state.path.trim()) {
    return false;
  }

  if (!state.qualityGateCommand.trim()) {
    return true;
  }

  const timeoutMs = parseOptionalPositiveInteger(state.qualityGateTimeoutMs);
  return timeoutMs === undefined || Number.isInteger(timeoutMs);
}

function parseOptionalPositiveInteger(value: string): number | undefined {
  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  const parsed = Number(trimmed);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : Number.NaN;
}
