import {
  auditEventSchema,
  operationsSnapshotSchema,
  readinessResponseSchema,
  workerHealthResponseSchema,
  workflowJobSchema,
  type OperationsSnapshot
} from "@mawo/shared";

type ApiClient = (path: string, init?: RequestInit) => Promise<unknown>;

export type OperationsSnapshotOptions = {
  repositoryId?: string;
};

export async function loadOperationsSnapshot(
  api: ApiClient,
  options: OperationsSnapshotOptions = {}
): Promise<OperationsSnapshot> {
  const paths = buildOperationsSnapshotPaths(options);

  try {
    return operationsSnapshotSchema.parse(await api(paths.snapshotPath));
  } catch {
    // Older API servers do not expose the aggregate endpoint yet. Keep the
    // console usable during rolling upgrades by falling back to legacy calls.
  }

  const [auditEvents, jobs, readiness, workerHealth] = await Promise.all([
    api(paths.auditEventsPath),
    api(paths.jobsPath),
    api(paths.readinessPath),
    api(paths.workerHealthPath)
  ]);

  const parsedAuditEvents = auditEventSchema.array().parse(auditEvents);
  const parsedJobs = workflowJobSchema.array().parse(jobs);
  const parsedReadiness = readinessResponseSchema.parse(readiness);
  const parsedWorkerHealth = workerHealthResponseSchema.parse(workerHealth);
  const queuedJobs = parsedJobs.filter((job) => job.status === "queued").length;
  const runningJobs = parsedJobs.filter((job) => job.status === "running").length;

  return operationsSnapshotSchema.parse({
    checkedAt: parsedReadiness.checkedAt,
    ...(options.repositoryId?.trim()
      ? { repositoryId: options.repositoryId.trim() }
      : {}),
    summary: {
      queuedJobs,
      runningJobs,
      activeJobs: queuedJobs + runningJobs,
      failedJobs: parsedJobs.filter((job) => job.status === "failed").length,
      needsReviewWorkflows: 0,
      blockedReadinessChecks: parsedReadiness.checks.filter(
        (check) => check.status === "blocked" || check.status === "failed"
      ).length,
      healthyWorkers: parsedWorkerHealth.summary.healthyWorkers,
      totalWorkers: parsedWorkerHealth.summary.totalWorkers
    },
    auditEvents: parsedAuditEvents,
    jobs: parsedJobs,
    readiness: parsedReadiness,
    workerHealth: parsedWorkerHealth
  });
}

export function buildOperationsSnapshotPaths(
  options: OperationsSnapshotOptions = {}
): {
  snapshotPath: string;
  auditEventsPath: string;
  jobsPath: string;
  readinessPath: string;
  workerHealthPath: string;
} {
  return {
    snapshotPath: buildPath("/operations/snapshot", options),
    auditEventsPath: buildPath("/audit-events", options),
    jobsPath: buildPath("/jobs", options),
    readinessPath: "/readiness",
    workerHealthPath: "/workers/health"
  };
}

function buildPath(basePath: string, options: OperationsSnapshotOptions): string {
  const params = new URLSearchParams({ limit: "8" });
  const repositoryId = options.repositoryId?.trim();

  if (repositoryId) {
    params.set("repositoryId", repositoryId);
  }

  return `${basePath}?${params.toString()}`;
}
