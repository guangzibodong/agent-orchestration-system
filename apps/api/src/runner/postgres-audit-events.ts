import type { AuditEventInput, AuditStore } from "./file-audit-store.js";
import type { WorkflowRuntimeEvent } from "./local-runner.js";
import type { PostgresWorkflowWorkerEvent } from "./postgres-workflow-worker.js";

export async function appendPostgresRunnerAuditEvent(
  auditStore: Pick<AuditStore, "append">,
  event: WorkflowRuntimeEvent
): Promise<void> {
  await auditStore.append({
    type: event.type,
    actor: "runner",
    workflowId: event.workflowId,
    metadata: toRunnerMetadata(event)
  });
}

export async function appendPostgresWorkerAuditEvent(
  auditStore: Pick<AuditStore, "append">,
  event: PostgresWorkflowWorkerEvent
): Promise<void> {
  await auditStore.append({
    type: event.type,
    actor: event.actor,
    ...(event.workflowId ? { workflowId: event.workflowId } : {}),
    ...(event.jobId ? { jobId: event.jobId } : {}),
    metadata: event.metadata
  });
}

function toRunnerMetadata(
  event: WorkflowRuntimeEvent
): NonNullable<AuditEventInput["metadata"]> {
  return {
    ...(event.taskId ? { taskId: event.taskId } : {}),
    ...(event.gateId ? { gateId: event.gateId } : {}),
    ...(event.status ? { status: event.status } : {}),
    ...(event.exitCode !== undefined ? { exitCode: String(event.exitCode) } : {}),
    ...(event.durationMs !== undefined
      ? { durationMs: String(event.durationMs) }
      : {})
  };
}
