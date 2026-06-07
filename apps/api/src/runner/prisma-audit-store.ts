import { auditEventSchema, type AuditEvent } from "@mawo/shared";
import type {
  AuditEventFilter,
  AuditEventInput,
  AuditStore
} from "./file-audit-store.js";

export type PrismaAuditEventRow = {
  id: string;
  type: string;
  actor: string | null;
  workflowRunId: string | null;
  jobId: string | null;
  metadata: unknown;
  createdAt: Date | string;
};

type PrismaAuditEventWhere = {
  actor?: string;
  jobId?: string;
  type?: string;
  workflowRunId?: string;
};

export type PrismaAuditStoreClient = {
  auditEvent: {
    findMany(args?: {
      where?: PrismaAuditEventWhere;
      orderBy?: {
        createdAt: "asc" | "desc";
      };
    }): Promise<PrismaAuditEventRow[]>;
    create(args: {
      data: {
        id?: string;
        type: string;
        actor: string | null;
        workflowRunId: string | null;
        jobId: string | null;
        metadata: unknown;
        createdAt?: Date;
      };
    }): Promise<PrismaAuditEventRow>;
  };
};

export class PrismaAuditStore implements AuditStore {
  private readonly client: PrismaAuditStoreClient;

  constructor(client: PrismaAuditStoreClient) {
    this.client = client;
  }

  async list(filter: AuditEventFilter = {}): Promise<AuditEvent[]> {
    const rows = await this.client.auditEvent.findMany({
      where: {
        ...(filter.workflowId ? { workflowRunId: filter.workflowId } : {}),
        ...(filter.jobId ? { jobId: filter.jobId } : {}),
        ...(filter.actor ? { actor: filter.actor } : {}),
        ...(filter.type ? { type: filter.type } : {})
      },
      orderBy: {
        createdAt: "asc"
      }
    });
    const events = rows.map(toAuditEvent);

    if (!filter.repositoryId && !filter.requirementId) {
      return events;
    }

    return events.filter((event) => {
      if (
        filter.repositoryId &&
        event.metadata?.repositoryId !== filter.repositoryId
      ) {
        return false;
      }

      if (
        filter.requirementId &&
        event.metadata?.requirementId !== filter.requirementId
      ) {
        return false;
      }

      return true;
    });
  }

  async append(input: AuditEventInput): Promise<AuditEvent> {
    const row = await this.client.auditEvent.create({
      data: {
        ...(input.id ? { id: input.id } : {}),
        type: input.type,
        actor: input.actor ?? null,
        workflowRunId: input.workflowId ?? null,
        jobId: input.jobId ?? null,
        metadata: input.metadata ?? null,
        ...(input.createdAt ? { createdAt: new Date(input.createdAt) } : {})
      }
    });

    return toAuditEvent(row);
  }
}

function toAuditEvent(row: PrismaAuditEventRow): AuditEvent {
  return auditEventSchema.parse({
    id: row.id,
    type: row.type,
    actor: row.actor ?? undefined,
    workflowId: row.workflowRunId ?? undefined,
    jobId: row.jobId ?? undefined,
    metadata: toMetadata(row.metadata),
    createdAt: toIsoString(row.createdAt)
  });
}

function toMetadata(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const metadata = Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  );

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
