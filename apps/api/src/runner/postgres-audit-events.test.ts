import { describe, expect, it } from "vitest";
import {
  appendPostgresRunnerAuditEvent,
  appendPostgresWorkerAuditEvent
} from "./postgres-audit-events.js";
import type { AuditEventInput } from "./file-audit-store.js";

function createDeferredAuditStore() {
  const appended: AuditEventInput[] = [];
  let resolveAppend: (() => void) | undefined;
  const appendStarted = new Promise<void>((resolve) => {
    resolveAppend = resolve;
  });

  return {
    appended,
    appendStarted,
    releaseAppend: () => resolveAppend?.(),
    store: {
      async append(input: AuditEventInput) {
        await appendStarted;
        appended.push(input);

        return {
          id: "audit-1",
          createdAt: "2026-06-06T00:00:00.000Z",
          type: input.type,
          actor: input.actor,
          workflowId: input.workflowId,
          jobId: input.jobId,
          metadata: input.metadata
        };
      }
    }
  };
}

describe("postgres audit event helpers", () => {
  it("awaits worker audit persistence before resolving", async () => {
    const audit = createDeferredAuditStore();
    let resolved = false;

    const pending = appendPostgresWorkerAuditEvent(audit.store, {
      type: "job.completed",
      actor: "worker",
      workflowId: "workflow-1",
      jobId: "job-1",
      metadata: {
        workerId: "worker-a"
      }
    }).then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(audit.appended).toEqual([]);

    audit.releaseAppend();
    await pending;

    expect(resolved).toBe(true);
    expect(audit.appended).toEqual([
      {
        type: "job.completed",
        actor: "worker",
        workflowId: "workflow-1",
        jobId: "job-1",
        metadata: {
          workerId: "worker-a"
        }
      }
    ]);
  });

  it("maps runner lifecycle metadata to string-safe audit fields", async () => {
    const audit = createDeferredAuditStore();
    const pending = appendPostgresRunnerAuditEvent(audit.store, {
      type: "workflow.task_completed",
      workflowId: "workflow-1",
      taskId: "task-1",
      status: "passed",
      exitCode: 0,
      durationMs: 42
    });

    audit.releaseAppend();
    await pending;

    expect(audit.appended).toEqual([
      {
        type: "workflow.task_completed",
        actor: "runner",
        workflowId: "workflow-1",
        metadata: {
          taskId: "task-1",
          status: "passed",
          exitCode: "0",
          durationMs: "42"
        }
      }
    ]);
  });
});
