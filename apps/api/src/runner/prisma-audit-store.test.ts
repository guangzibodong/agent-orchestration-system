import { describe, expect, it } from "vitest";
import { PrismaAuditStore } from "./prisma-audit-store.js";

type AuditRow = {
  id: string;
  type: string;
  actor: string | null;
  workflowRunId: string | null;
  jobId: string | null;
  metadata: unknown;
  createdAt: Date;
};

type AuditWhere = {
  actor?: string;
  jobId?: string;
  type?: string;
  workflowRunId?: string;
};

function createAuditClient() {
  const rows: AuditRow[] = [];
  let nextId = 1;
  let nextMinute = 0;

  const now = () => {
    const date = new Date(`2026-06-05T00:${String(nextMinute).padStart(2, "0")}:00.000Z`);
    nextMinute += 1;
    return date;
  };

  return {
    rows,
    auditEvent: {
      async create(args: {
        data: {
          id?: string;
          type: string;
          actor?: string | null;
          workflowRunId?: string | null;
          jobId?: string | null;
          metadata?: unknown;
          createdAt?: Date;
        };
      }) {
        const row = {
          id: args.data.id ?? `audit-${nextId}`,
          type: args.data.type,
          actor: args.data.actor ?? null,
          workflowRunId: args.data.workflowRunId ?? null,
          jobId: args.data.jobId ?? null,
          metadata: args.data.metadata ?? null,
          createdAt: args.data.createdAt ?? now()
        };
        nextId += 1;
        rows.push(row);
        return row;
      },
      async findMany(args: { where?: AuditWhere }) {
        return rows
          .filter((row) => {
            const where = args.where ?? {};
            if (where.actor && row.actor !== where.actor) {
              return false;
            }
            if (where.jobId && row.jobId !== where.jobId) {
              return false;
            }
            if (where.type && row.type !== where.type) {
              return false;
            }
            if (where.workflowRunId && row.workflowRunId !== where.workflowRunId) {
              return false;
            }
            return true;
          })
          .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
      }
    }
  };
}

describe("PrismaAuditStore", () => {
  it("appends audit events and maps Prisma rows to API records", async () => {
    const client = createAuditClient();
    const store = new PrismaAuditStore(client);

    const event = await store.append({
      id: "audit-fixed",
      createdAt: "2026-06-05T01:00:00.000Z",
      type: "workflow.enqueued",
      actor: "operator",
      workflowId: "workflow-1",
      jobId: "job-1",
      metadata: {
        repositoryId: "repo-1",
        status: "queued"
      }
    });

    expect(event).toEqual({
      id: "audit-fixed",
      type: "workflow.enqueued",
      actor: "operator",
      workflowId: "workflow-1",
      jobId: "job-1",
      createdAt: "2026-06-05T01:00:00.000Z",
      metadata: {
        repositoryId: "repo-1",
        status: "queued"
      }
    });
    expect(client.rows).toEqual([
      expect.objectContaining({
        id: "audit-fixed",
        workflowRunId: "workflow-1",
        jobId: "job-1"
      })
    ]);
  });

  it("filters audit events by type actor workflow job and repository metadata", async () => {
    const client = createAuditClient();
    const store = new PrismaAuditStore(client);

    const repositoryEvent = await store.append({
      type: "repository.updated",
      actor: "operator",
      metadata: {
        repositoryId: "repo-1",
        repositoryName: "Core repo"
      }
    });
    await store.append({
      type: "repository.deleted",
      actor: "operator",
      metadata: {
        repositoryId: "repo-2",
        repositoryName: "Old repo"
      }
    });
    const jobEvent = await store.append({
      type: "job.canceled",
      actor: "operator",
      workflowId: "workflow-1",
      jobId: "job-1",
      metadata: {
        repositoryId: "repo-1",
        status: "canceled"
      }
    });

    await expect(
      store.list({
        type: "repository.updated",
        actor: "operator",
        repositoryId: "repo-1"
      })
    ).resolves.toEqual([repositoryEvent]);
    await expect(
      store.list({
        jobId: "job-1",
        actor: "operator",
        workflowId: "workflow-1",
        repositoryId: "repo-1"
      })
    ).resolves.toEqual([jobEvent]);
  });

  it("filters audit events by requirement metadata for requirement audit history", async () => {
    const client = createAuditClient();
    const store = new PrismaAuditStore(client);

    const requirementEvent = await store.append({
      type: "workflow.created",
      actor: "operator",
      workflowId: "workflow-1",
      metadata: {
        requirementId: "requirement-1",
        status: "ready"
      }
    });
    await store.append({
      type: "workflow.created",
      actor: "operator",
      workflowId: "workflow-2",
      metadata: {
        requirementId: "requirement-2",
        status: "ready"
      }
    });

    await expect(
      store.list({
        requirementId: "requirement-1"
      })
    ).resolves.toEqual([requirementEvent]);
  });
});
