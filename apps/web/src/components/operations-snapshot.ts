import {
  auditEventSchema,
  workflowJobSchema,
  type AuditEvent,
  type WorkflowJob
} from "@mawo/shared";

type ApiClient = (path: string, init?: RequestInit) => Promise<unknown>;

export type OperationsSnapshot = {
  auditEvents: AuditEvent[];
  jobs: WorkflowJob[];
};

export async function loadOperationsSnapshot(
  api: ApiClient
): Promise<OperationsSnapshot> {
  const [auditEvents, jobs] = await Promise.all([
    api("/audit-events?limit=8"),
    api("/jobs?limit=8")
  ]);

  return {
    auditEvents: auditEventSchema.array().parse(auditEvents),
    jobs: workflowJobSchema.array().parse(jobs)
  };
}
