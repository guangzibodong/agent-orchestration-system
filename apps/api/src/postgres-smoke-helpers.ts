export type SmokeJsonObject = Record<string, unknown>;

export function requireDatabaseUrl(
  env: Record<string, string | undefined> = process.env
): string {
  const databaseUrl = env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required for the Postgres API smoke test. Run migrations first, then retry."
    );
  }

  return databaseUrl;
}

export function assertPostgresRuntimeReady(checks: SmokeJsonObject[]): void {
  const runtimeCheck = checks.find((check) => check.id === "runtime_backend");

  if (
    !runtimeCheck ||
    runtimeCheck.ok !== true ||
    runtimeCheck.activeStateBackend !== "postgres"
  ) {
    throw new Error(
      "Readiness must report runtime_backend ok=true and activeStateBackend=postgres."
    );
  }

  if (runtimeCheck.activeQueueBackend !== "postgres") {
    throw new Error(
      "Readiness must report runtime_backend ok=true and activeQueueBackend=postgres."
    );
  }
}
