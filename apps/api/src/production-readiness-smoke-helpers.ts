export type SmokeJsonObject = Record<string, unknown>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function requireChecks(readiness: SmokeJsonObject): SmokeJsonObject[] {
  assert(
    Array.isArray(readiness.checks),
    "Readiness must include a checks array.",
  );

  return readiness.checks.filter(
    (check): check is SmokeJsonObject =>
      Boolean(check) && typeof check === "object" && !Array.isArray(check),
  );
}

function requireCheck(
  checks: SmokeJsonObject[],
  id: string,
): SmokeJsonObject {
  const check = checks.find((candidate) => candidate.id === id);

  assert(check, `Readiness must include ${id}.`);

  return check;
}

function assertReadyCheck(checks: SmokeJsonObject[], id: string) {
  const check = requireCheck(checks, id);

  assert(
    check.ok === true && check.status === "ready",
    `Readiness check ${id} must be ready.`,
  );

  return check;
}

function assertCheckValue(
  check: SmokeJsonObject,
  key: string,
  expected: unknown,
) {
  assert(
    check[key] === expected,
    `Readiness check ${String(check.id)} must report ${key}=${String(
      expected,
    )}.`,
  );
}

export function assertProductionReadinessSmokeReady(
  readiness: SmokeJsonObject,
): void {
  assert(
    !JSON.stringify(readiness).includes("{promptFile}"),
    "Production readiness leaked a command template.",
  );
  assert(readiness.ok === true, "Readiness must report ok=true.");
  assert(readiness.service === "mawo-api", "Readiness must report mawo-api.");
  assert(
    readiness.deploymentMode === "production",
    "Readiness must report deploymentMode=production.",
  );
  assert(
    readiness.protectedByToken === true,
    "Readiness must report protectedByToken=true.",
  );
  assert(
    readiness.activeJobs === 0,
    "Readiness must start with activeJobs=0 for the production smoke.",
  );

  const checks = requireChecks(readiness);

  for (const id of ["state_store", "artifact_store", "git_cli", "agents"]) {
    assertReadyCheck(checks, id);
  }

  const productionConfig = assertReadyCheck(checks, "production_config");
  assertCheckValue(productionConfig, "deploymentMode", "production");
  assertCheckValue(productionConfig, "protectedByToken", true);
  assertCheckValue(
    productionConfig,
    "allowedRepositoryRootsConfigured",
    true,
  );
  assert(
    Array.isArray(productionConfig.missing) &&
      productionConfig.missing.length === 0,
    "Production config readiness must not report missing settings.",
  );

  const runtimeBackend = assertReadyCheck(checks, "runtime_backend");
  assertCheckValue(runtimeBackend, "requestedStateBackend", "file");
  assertCheckValue(runtimeBackend, "activeStateBackend", "file");
  assertCheckValue(runtimeBackend, "requestedQueueBackend", "in_process");
  assertCheckValue(runtimeBackend, "activeQueueBackend", "in_process");

  const workerHealth = assertReadyCheck(checks, "workers");
  assertCheckValue(workerHealth, "required", false);

  const deploymentTopology = assertReadyCheck(checks, "deployment_topology");
  assertCheckValue(deploymentTopology, "deploymentMode", "production");
  assertCheckValue(deploymentTopology, "apiReplicaCount", 1);
  assertCheckValue(deploymentTopology, "stateBackend", "file");
  assertCheckValue(deploymentTopology, "queueBackend", "in_process");
}
