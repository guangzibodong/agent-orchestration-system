import { resolve } from "node:path";
import type { RepositoryRecord } from "@mawo/shared";
import { describe, expect, it, vi } from "vitest";
import { inspectRepositorySafety } from "./repository-safety.js";

function repository(path: string): RepositoryRecord {
  return {
    id: "repo_1",
    name: "Main repository",
    path,
    defaultBranch: "main",
    qualityGates: [],
    createdAt: "2026-06-05T00:00:00.000Z",
    updatedAt: "2026-06-05T00:00:00.000Z",
  };
}

describe("inspectRepositorySafety", () => {
  it("reports branch head clean state allowed root and manual apply policy", () => {
    const repoPath = resolve("tmp", "mawo", "repo");
    const runGit = vi.fn((args: string[]) => {
      const command = args.join(" ");

      if (command === "rev-parse --show-toplevel") {
        return { status: 0, stdout: `${repoPath}\n`, stderr: "" };
      }

      if (command === "rev-parse --verify HEAD") {
        return {
          status: 0,
          stdout: "abc1234567890abcdef1234567890abcdef1234\n",
          stderr: "",
        };
      }

      if (command === "rev-parse --abbrev-ref HEAD") {
        return { status: 0, stdout: "feature/repository-safety\n", stderr: "" };
      }

      if (command === "rev-parse --short HEAD") {
        return { status: 0, stdout: "abc1234\n", stderr: "" };
      }

      if (command === "status --short") {
        return { status: 0, stdout: "", stderr: "" };
      }

      return { status: 1, stdout: "", stderr: `unexpected git ${command}` };
    });

    const safety = inspectRepositorySafety({
      repository: repository(repoPath),
      allowedRoots: [resolve("tmp", "mawo")],
      runGit,
    });

    expect(safety).toEqual({
      repositoryId: "repo_1",
      path: repoPath,
      defaultBranch: "main",
      currentBranch: "feature/repository-safety",
      headShortSha: "abc1234",
      clean: true,
      dirty: false,
      allowedRoot: true,
      noAutoMerge: true,
      manualApplyPolicy:
        "Manual review is required; MAWO never automatically merges repository changes.",
    });
  });

  it("blocks repositories outside configured allowed roots before running git", () => {
    const repoPath = resolve("tmp", "mawo", "outside", "repo");
    const runGit = vi.fn();

    const safety = inspectRepositorySafety({
      repository: repository(repoPath),
      allowedRoots: [resolve("tmp", "mawo", "allowed")],
      runGit,
    });

    expect(safety).toMatchObject({
      repositoryId: "repo_1",
      path: repoPath,
      clean: false,
      dirty: false,
      allowedRoot: false,
      blockedReason: "repository_path_not_allowed",
      recoveryAction:
        "Move the repository under MAWO_ALLOWED_REPOSITORY_ROOTS or update MAWO_ALLOWED_REPOSITORY_ROOTS.",
    });
    expect(runGit).not.toHaveBeenCalled();
  });

  it("blocks dirty repositories with a recovery action", () => {
    const repoPath = resolve("tmp", "mawo", "repo");
    const runGit = vi.fn((args: string[]) => {
      const command = args.join(" ");

      if (command === "status --short") {
        return {
          status: 0,
          stdout: " M README.md\n?? LOCAL.txt\n",
          stderr: "",
        };
      }

      if (command === "rev-parse --abbrev-ref HEAD") {
        return { status: 0, stdout: "main\n", stderr: "" };
      }

      if (command === "rev-parse --short HEAD") {
        return { status: 0, stdout: "def5678\n", stderr: "" };
      }

      return { status: 0, stdout: `${repoPath}\n`, stderr: "" };
    });

    const safety = inspectRepositorySafety({
      repository: repository(repoPath),
      allowedRoots: [],
      runGit,
    });

    expect(safety).toMatchObject({
      currentBranch: "main",
      headShortSha: "def5678",
      clean: false,
      dirty: true,
      allowedRoot: true,
      blockedReason: "repository_dirty",
      recoveryAction:
        "Commit, stash, or discard local changes before running mutating workflows.",
    });
  });
});
