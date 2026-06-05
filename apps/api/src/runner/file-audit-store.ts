import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  auditEventSchema,
  type AuditEvent,
  type AuditEventType
} from "@mawo/shared";
import { writeJsonFileAtomically } from "./atomic-json-file.js";

export type AuditEventInput = Omit<AuditEvent, "id" | "createdAt"> & {
  id?: string;
  createdAt?: string;
};

export type AuditEventFilter = {
  actor?: string;
  jobId?: string;
  repositoryId?: string;
  type?: AuditEventType;
  workflowId?: string;
};

type MaybePromise<T> = T | Promise<T>;

export type AuditStore = {
  list(filter?: AuditEventFilter): MaybePromise<AuditEvent[]>;
  append(event: AuditEventInput): MaybePromise<AuditEvent>;
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

    return events.filter((event) => {
      if (filter.workflowId && event.workflowId !== filter.workflowId) {
        return false;
      }

      if (filter.jobId && event.jobId !== filter.jobId) {
        return false;
      }

      if (filter.actor && event.actor !== filter.actor) {
        return false;
      }

      if (filter.type && event.type !== filter.type) {
        return false;
      }

      if (
        filter.repositoryId &&
        event.metadata?.repositoryId !== filter.repositoryId
      ) {
        return false;
      }

      return true;
    });
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

    writeJsonFileAtomically(this.stateFile, events);

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
