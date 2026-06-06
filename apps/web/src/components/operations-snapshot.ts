import {
  auditEventSchema,
  readinessResponseSchema,
  workerHealthResponseSchema,
  workflowJobSchema,
  type AuditEvent,
  type ReadinessResponse,
  type WorkerHealthResponse,
  type WorkflowJob
} from "@mawo/shared";

type ApiClient = (path: string, init?: RequestInit) => Promise<unknown>;

export type OperationsSnapshotOptions = {
  repositoryId?: string;
};

export type OperationsSnapshot = {
  auditEvents: AuditEvent[];
  jobs: WorkflowJob[];
  readiness: ReadinessResponse;
  workerHealth: WorkerHealthResponse;
};

export async function loadOperationsSnapshot(
  api: ApiClient,
  options: OperationsSnapshotOptions = {}
): Promise<OperationsSnapshot> {
  const paths = buildOperationsSnapshotPaths(options);
  const [auditEvents, jobs, readiness, workerHealth] = await Promise.all([
    api(paths.auditEventsPath),
    api(paths.jobsPath),
    api(paths.readinessPath),
    api(paths.workerHealthPath)
  ]);

  return {
    auditEvents: auditEventSchema.array().parse(auditEvents),
    jobs: workflowJobSchema.array().parse(jobs),
    readiness: readinessResponseSchema.parse(readiness),
    workerHealth: workerHealthResponseSchema.parse(workerHealth)
  };
}

export function buildOperationsSnapshotPaths(
  options: OperationsSnapshotOptions = {}
): {
  auditEventsPath: string;
  jobsPath: string;
  readinessPath: string;
  workerHealthPath: string;
} {
  return {
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
