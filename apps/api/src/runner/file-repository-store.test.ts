import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileRepositoryStore } from "./file-repository-store.js";

const tempRoots: string[] = [];

afterEach(async () => {
  vi.useRealTimers();

  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("FileRepositoryStore", () => {
  it("updates an existing repository matching the normalized path", async () => {
    const root = await mkdtemp(join(tmpdir(), "mawo-repository-store-test-"));
    tempRoots.push(root);
    const repoPath = join(root, "repo");
    const store = new FileRepositoryStore({
      stateFile: join(root, "state", "repositories.json")
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-05T00:00:00.000Z"));
    const created = store.upsert({
      name: "Original repo",
      path: repoPath,
      defaultBranch: "main",
      qualityGates: []
    });

    vi.setSystemTime(new Date("2026-06-05T00:01:00.000Z"));
    const updated = store.upsert({
      name: "Updated repo",
      path: `${repoPath}${sep}.`,
      defaultBranch: "develop",
      qualityGates: [
        {
          id: "test",
          title: "Test gate",
          command: "npm test"
        }
      ]
    });

    expect(created.created).toBe(true);
    expect(updated.created).toBe(false);
    expect(updated.repository).toMatchObject({
      id: created.repository.id,
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
    expect(store.list()).toEqual([updated.repository]);
  });
});
