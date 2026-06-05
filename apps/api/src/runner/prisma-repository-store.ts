import { resolve } from "node:path";
import {
  repositoryRecordSchema,
  type RepositoryRecord,
  type RepositoryRegistrationRequest
} from "@mawo/shared";
import type {
  RepositoryStore,
  RepositoryUpsertResult
} from "./file-repository-store.js";

export type PrismaRepositoryRecordRow = {
  id: string;
  name: string;
  path: string;
  defaultBranch: string | null;
  qualityGates: unknown;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type PrismaRepositoryStoreClient = {
  repositoryRecord: {
    findMany(args?: {
      orderBy?: {
        updatedAt: "asc" | "desc";
      };
    }): Promise<PrismaRepositoryRecordRow[]>;
    findUnique(args: {
      where:
        | {
            id: string;
          }
        | {
            path: string;
          };
    }): Promise<PrismaRepositoryRecordRow | null>;
    create(args: {
      data: {
        name: string;
        path: string;
        defaultBranch: string | null;
        qualityGates: unknown;
      };
    }): Promise<PrismaRepositoryRecordRow>;
    update(args: {
      where: {
        id: string;
      };
      data: {
        name: string;
        path: string;
        defaultBranch: string | null;
        qualityGates: unknown;
      };
    }): Promise<PrismaRepositoryRecordRow>;
    delete(args: {
      where: {
        id: string;
      };
    }): Promise<PrismaRepositoryRecordRow>;
  };
};

export class PrismaRepositoryStore implements RepositoryStore {
  private readonly client: PrismaRepositoryStoreClient;

  constructor(client: PrismaRepositoryStoreClient) {
    this.client = client;
  }

  async list(): Promise<RepositoryRecord[]> {
    const rows = await this.client.repositoryRecord.findMany({
      orderBy: {
        updatedAt: "asc"
      }
    });

    return rows.map(toRepositoryRecord);
  }

  async get(id: string): Promise<RepositoryRecord | undefined> {
    const row = await this.client.repositoryRecord.findUnique({
      where: {
        id
      }
    });

    return row ? toRepositoryRecord(row) : undefined;
  }

  async upsert(
    input: RepositoryRegistrationRequest
  ): Promise<RepositoryUpsertResult> {
    const normalizedPath = resolve(input.path);
    const existing = await this.client.repositoryRecord.findUnique({
      where: {
        path: normalizedPath
      }
    });

    if (existing) {
      const previous = toRepositoryRecord(existing);
      const row = await this.client.repositoryRecord.update({
        where: {
          id: existing.id
        },
        data: {
          name: input.name,
          path: normalizedPath,
          defaultBranch: input.defaultBranch ?? null,
          qualityGates: input.qualityGates
        }
      });

      return {
        repository: toRepositoryRecord(row),
        created: false,
        previous
      };
    }

    const row = await this.client.repositoryRecord.create({
      data: {
        name: input.name,
        path: normalizedPath,
        defaultBranch: input.defaultBranch ?? null,
        qualityGates: input.qualityGates
      }
    });

    return {
      repository: toRepositoryRecord(row),
      created: true
    };
  }

  async remove(id: string): Promise<RepositoryRecord | undefined> {
    const existing = await this.client.repositoryRecord.findUnique({
      where: {
        id
      }
    });

    if (!existing) {
      return undefined;
    }

    const row = await this.client.repositoryRecord.delete({
      where: {
        id
      }
    });

    return toRepositoryRecord(row);
  }
}

function toRepositoryRecord(row: PrismaRepositoryRecordRow): RepositoryRecord {
  return repositoryRecordSchema.parse({
    id: row.id,
    name: row.name,
    path: row.path,
    defaultBranch: row.defaultBranch ?? undefined,
    qualityGates: row.qualityGates,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  });
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
