import {
  auditEventSchema,
  readinessResponseSchema,
  workflowJobSchema,
  type AuditEvent,
  type ReadinessResponse,
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
};

export async function loadOperationsSnapshot(
  api: ApiClient,
  options: OperationsSnapshotOptions = {}
): Promise<OperationsSnapshot> {
  const paths = buildOperationsSnapshotPaths(options);
  const [auditEvents, jobs, readiness] = await Promise.all([
    api(paths.auditEventsPath),
    api(paths.jobsPath),
    api(paths.readinessPath)
  ]);

  return {
    auditEvents: auditEventSchema.array().parse(auditEvents),
    jobs: workflowJobSchema.array().parse(jobs),
    readiness: readinessResponseSchema.parse(readiness)
  };
}

export function buildOperationsSnapshotPaths(
  options: OperationsSnapshotOptions = {}
): { auditEventsPath: string; jobsPath: string; readinessPath: string } {
  return {
    auditEventsPath: buildPath("/audit-events", options),
    jobsPath: buildPath("/jobs", options),
    readinessPath: "/readiness"
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
