import type { RepositoryRecord } from "@mawo/shared";

export type RepositoryDisplay = {
  id: string;
  name: string;
  path: string;
  defaultBranch: string;
  qualityGateLabel: string;
  updatedAt: string;
};

export function buildRepositoryDisplay(
  repositories: RepositoryRecord[]
): RepositoryDisplay[] {
  return repositories.map((repository) => {
    const gateCount = repository.qualityGates.length;

    return {
      id: repository.id,
      name: repository.name,
      path: repository.path,
      defaultBranch: repository.defaultBranch ?? "default",
      qualityGateLabel: `${gateCount} ${gateCount === 1 ? "gate" : "gates"}`,
      updatedAt: repository.updatedAt
    };
  });
}

export function summarizeRepositories(repositories: RepositoryRecord[]): {
  total: number;
  withQualityGates: number;
} {
  return {
    total: repositories.length,
    withQualityGates: repositories.filter(
      (repository) => repository.qualityGates.length > 0
    ).length
  };
}
