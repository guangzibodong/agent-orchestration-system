import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  repositoryRecordSchema,
  type RepositoryRecord,
  type RepositoryRegistrationRequest
} from "@mawo/shared";

export type RepositoryStore = {
  list(): RepositoryRecord[];
  get(id: string): RepositoryRecord | undefined;
  create(input: RepositoryRegistrationRequest): RepositoryRecord;
};

export type FileRepositoryStoreOptions = {
  stateFile: string;
};

export class FileRepositoryStore implements RepositoryStore {
  private readonly stateFile: string;

  constructor(options: FileRepositoryStoreOptions) {
    this.stateFile = options.stateFile;
  }

  list(): RepositoryRecord[] {
    try {
      const parsed = JSON.parse(readFileSync(this.stateFile, "utf8")) as unknown[];
      return parsed.map((repository) => repositoryRecordSchema.parse(repository));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return [];
      }

      throw error;
    }
  }

  get(id: string): RepositoryRecord | undefined {
    return this.list().find((repository) => repository.id === id);
  }

  create(input: RepositoryRegistrationRequest): RepositoryRecord {
    const now = new Date().toISOString();
    const repository = repositoryRecordSchema.parse({
      id: randomUUID(),
      name: input.name,
      path: input.path,
      defaultBranch: input.defaultBranch,
      qualityGates: input.qualityGates,
      createdAt: now,
      updatedAt: now
    });
    const repositories = [...this.list(), repository];

    mkdirSync(dirname(this.stateFile), { recursive: true });
    const tempFile = `${this.stateFile}.tmp`;
    writeFileSync(tempFile, JSON.stringify(repositories, null, 2), "utf8");
    renameSync(tempFile, this.stateFile);

    return repository;
  }
}
