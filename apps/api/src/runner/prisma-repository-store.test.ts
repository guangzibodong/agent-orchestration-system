import { resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { PrismaRepositoryStore } from "./prisma-repository-store.js";

type RepositoryRow = {
  id: string;
  name: string;
  path: string;
  defaultBranch: string | null;
  qualityGates: unknown;
  createdAt: Date;
  updatedAt: Date;
};

function createRepositoryClient() {
  const rows: RepositoryRow[] = [];
  let nextId = 1;
  let nextMinute = 0;

  const now = () => {
    const date = new Date(`2026-06-05T00:${String(nextMinute).padStart(2, "0")}:00.000Z`);
    nextMinute += 1;
    return date;
  };

  return {
    rows,
    repositoryRecord: {
      async findMany() {
        return [...rows].sort((left, right) => left.updatedAt.getTime() - right.updatedAt.getTime());
      },
      async findUnique(args: { where: { id?: string; path?: string } }) {
        return (
          rows.find((row) =>
            args.where.id !== undefined ? row.id === args.where.id : row.path === args.where.path
          ) ?? null
        );
      },
      async create(args: {
        data: {
          name: string;
          path: string;
          defaultBranch?: string | null;
          qualityGates: unknown;
        };
      }) {
        const createdAt = now();
        const row = {
          id: `repo-${nextId}`,
          name: args.data.name,
          path: args.data.path,
          defaultBranch: args.data.defaultBranch ?? null,
          qualityGates: args.data.qualityGates,
          createdAt,
          updatedAt: createdAt
        };
        nextId += 1;
        rows.push(row);
        return row;
      },
      async update(args: {
        where: { id: string };
        data: {
          name: string;
          path: string;
          defaultBranch?: string | null;
          qualityGates: unknown;
        };
      }) {
        const row = rows.find((current) => current.id === args.where.id);
        if (!row) {
          throw new Error("repository not found");
        }

        row.name = args.data.name;
        row.path = args.data.path;
        row.defaultBranch = args.data.defaultBranch ?? null;
        row.qualityGates = args.data.qualityGates;
        row.updatedAt = now();

        return row;
      },
      async delete(args: { where: { id: string } }) {
        const index = rows.findIndex((row) => row.id === args.where.id);
        if (index < 0) {
          throw new Error("repository not found");
        }

        return rows.splice(index, 1)[0];
      }
    }
  };
}

describe("PrismaRepositoryStore", () => {
  it("upserts by normalized path and returns the previous repository record", async () => {
    const client = createRepositoryClient();
    const store = new PrismaRepositoryStore(client);
    const repoPath = resolve("example-repo");

    const created = await store.upsert({
      name: "Original repo",
      path: repoPath,
      defaultBranch: "main",
      qualityGates: []
    });
    const updated = await store.upsert({
      name: "Updated repo",
      path: `${repoPath}${sep}.`,
      defaultBranch: "develop",
      qualityGates: [
        {
          id: "test",
          title: "Test gate",
          command: "npm test",
          required: true
        }
      ]
    });

    expect(created.created).toBe(true);
    expect(created.repository).toMatchObject({
      id: "repo-1",
      name: "Original repo",
      path: repoPath,
      defaultBranch: "main",
      createdAt: "2026-06-05T00:00:00.000Z",
      updatedAt: "2026-06-05T00:00:00.000Z"
    });
    expect(updated.created).toBe(false);
    expect(updated.previous).toEqual(created.repository);
    expect(updated.repository).toMatchObject({
      id: "repo-1",
      name: "Updated repo",
      path: repoPath,
      defaultBranch: "develop",
      createdAt: "2026-06-05T00:00:00.000Z",
      updatedAt: "2026-06-05T00:01:00.000Z",
      qualityGates: [
        expect.objectContaining({
          id: "test",
          command: "npm test"
        })
      ]
    });
    await expect(store.list()).resolves.toEqual([updated.repository]);
    await expect(store.get("repo-1")).resolves.toEqual(updated.repository);
  });

  it("removes repositories by id", async () => {
    const client = createRepositoryClient();
    const store = new PrismaRepositoryStore(client);
    const created = await store.upsert({
      name: "Removable repo",
      path: resolve("removable-repo"),
      qualityGates: []
    });

    await expect(store.remove(created.repository.id)).resolves.toEqual(created.repository);
    await expect(store.remove("missing")).resolves.toBeUndefined();
    await expect(store.list()).resolves.toEqual([]);
  });
});
