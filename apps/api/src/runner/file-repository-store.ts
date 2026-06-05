import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  repositoryRecordSchema,
  type RepositoryRecord,
  type RepositoryRegistrationRequest
} from "@mawo/shared";
import { writeJsonFileAtomically } from "./atomic-json-file.js";

export type RepositoryUpsertResult = {
  repository: RepositoryRecord;
  created: boolean;
  previous?: RepositoryRecord;
};

type MaybePromise<T> = T | Promise<T>;

export type RepositoryStore = {
  list(): MaybePromise<RepositoryRecord[]>;
  get(id: string): MaybePromise<RepositoryRecord | undefined>;
  upsert(input: RepositoryRegistrationRequest): MaybePromise<RepositoryUpsertResult>;
  remove(id: string): MaybePromise<RepositoryRecord | undefined>;
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

  upsert(input: RepositoryRegistrationRequest): RepositoryUpsertResult {
    const now = new Date().toISOString();
    const normalizedPath = resolve(input.path);
    const repositories = this.list();
    const existingIndex = repositories.findIndex(
      (repository) => resolve(repository.path) === normalizedPath
    );

    if (existingIndex >= 0) {
      const previous = repositories[existingIndex];
      const repository = repositoryRecordSchema.parse({
        ...previous,
        name: input.name,
        path: normalizedPath,
        defaultBranch: input.defaultBranch,
        qualityGates: input.qualityGates,
        updatedAt: now
      });
      const updatedRepositories = repositories.map((current, index) =>
        index === existingIndex ? repository : current
      );

      this.write(updatedRepositories);

      return {
        repository,
        created: false,
        previous
      };
    }

    const repository = repositoryRecordSchema.parse({
      id: randomUUID(),
      name: input.name,
      path: normalizedPath,
      defaultBranch: input.defaultBranch,
      qualityGates: input.qualityGates,
      createdAt: now,
      updatedAt: now
    });

    this.write([...repositories, repository]);

    return {
      repository,
      created: true
    };
  }

  remove(id: string): RepositoryRecord | undefined {
    const repositories = this.list();
    const repository = repositories.find((current) => current.id === id);

    if (!repository) {
      return undefined;
    }

    this.write(repositories.filter((current) => current.id !== id));

    return repository;
  }

  private write(repositories: RepositoryRecord[]): void {
    writeJsonFileAtomically(this.stateFile, repositories);
  }
}
