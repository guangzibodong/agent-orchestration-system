import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { auditEventSchema, type AuditEvent } from "@mawo/shared";

export type AuditEventInput = Omit<AuditEvent, "id" | "createdAt"> & {
  id?: string;
  createdAt?: string;
};

export type AuditEventFilter = {
  workflowId?: string;
};

export type AuditStore = {
  list(filter?: AuditEventFilter): AuditEvent[];
  append(event: AuditEventInput): AuditEvent;
};

export type FileAuditStoreOptions = {
  stateFile: string;
};

export class FileAuditStore implements AuditStore {
  private readonly stateFile: string;

  constructor(options: FileAuditStoreOptions) {
    this.stateFile = options.stateFile;
  }

  list(filter: AuditEventFilter = {}): AuditEvent[] {
    const events = this.readAll();

    if (!filter.workflowId) {
      return events;
    }

    return events.filter((event) => event.workflowId === filter.workflowId);
  }

  append(input: AuditEventInput): AuditEvent {
    const event = auditEventSchema.parse({
      id: input.id ?? randomUUID(),
      createdAt: input.createdAt ?? new Date().toISOString(),
      actor: input.actor,
      type: input.type,
      workflowId: input.workflowId,
      jobId: input.jobId,
      metadata: input.metadata
    });
    const events = [...this.readAll(), event];

    mkdirSync(dirname(this.stateFile), { recursive: true });
    const tempFile = `${this.stateFile}.tmp`;
    writeFileSync(tempFile, JSON.stringify(events, null, 2), "utf8");
    renameSync(tempFile, this.stateFile);

    return event;
  }

  private readAll(): AuditEvent[] {
    try {
      const parsed = JSON.parse(readFileSync(this.stateFile, "utf8")) as unknown[];
      return parsed.map((event) => auditEventSchema.parse(event));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return [];
      }

      throw error;
    }
  }
}
