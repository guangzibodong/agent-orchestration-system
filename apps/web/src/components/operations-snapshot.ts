import {
  auditEventSchema,
  workflowJobSchema,
  type AuditEvent,
  type WorkflowJob
} from "@mawo/shared";

type ApiClient = (path: string, init?: RequestInit) => Promise<unknown>;

export type OperationsSnapshotOptions = {
  repositoryId?: string;
};

export type OperationsSnapshot = {
  auditEvents: AuditEvent[];
  jobs: WorkflowJob[];
};

export async function loadOperationsSnapshot(
  api: ApiClient,
  options: OperationsSnapshotOptions = {}
): Promise<OperationsSnapshot> {
  const paths = buildOperationsSnapshotPaths(options);
  const [auditEvents, jobs] = await Promise.all([
    api(paths.auditEventsPath),
    api(paths.jobsPath)
  ]);

  return {
    auditEvents: auditEventSchema.array().parse(auditEvents),
    jobs: workflowJobSchema.array().parse(jobs)
  };
}

export function buildOperationsSnapshotPaths(
  options: OperationsSnapshotOptions = {}
): { auditEventsPath: string; jobsPath: string } {
  return {
    auditEventsPath: buildPath("/audit-events", options),
    jobsPath: buildPath("/jobs", options)
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
