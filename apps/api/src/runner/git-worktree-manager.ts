import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ShellAdapter } from "./shell-adapter.js";

export type WorktreeWorkspace = {
  path: string;
  branch: string;
  repoPath: string;
};

export type DiffArtifact = {
  status: string;
  patch: string;
};

export type GitWorktreeManagerOptions = {
  repoPath: string;
  worktreeRoot?: string;
  shell?: ShellAdapter;
};

export type CreateWorkspaceInput = {
  workflowId: string;
  taskId: string;
};

export class GitWorktreeManager {
  private readonly repoPath: string;
  private readonly worktreeRoot: string;
  private readonly shell: ShellAdapter;

  constructor(options: GitWorktreeManagerOptions) {
    this.repoPath = options.repoPath;
    this.worktreeRoot =
      options.worktreeRoot ?? join(options.repoPath, ".mawo", "worktrees");
    this.shell = options.shell ?? new ShellAdapter();
  }

  async createWorkspace(input: CreateWorkspaceInput): Promise<WorktreeWorkspace> {
    await this.assertCommittedHead();
    await mkdir(this.worktreeRoot, { recursive: true });

    const workflowSlug = slug(input.workflowId);
    const taskSlug = slug(input.taskId);
    const suffix = randomUUID().slice(0, 8);
    const branch = `mawo/${workflowSlug}/${taskSlug}-${suffix}`;
    const path = join(this.worktreeRoot, `${workflowSlug}-${taskSlug}-${suffix}`);

    await this.git(`worktree add -b ${quote(branch)} ${quote(path)} HEAD`);

    return {
      path,
      branch,
      repoPath: this.repoPath
    };
  }

  async collectDiff(workspace: WorktreeWorkspace): Promise<DiffArtifact> {
    const status = await this.git("status --short", workspace.path);
    await this.git("add --intent-to-add -- .", workspace.path);
    const patch = await this.git("diff --binary -- .", workspace.path);

    return {
      status: status.stdout,
      patch: patch.stdout
    };
  }

  async removeWorkspace(workspace: WorktreeWorkspace): Promise<void> {
    if (existsSync(workspace.path)) {
      await this.git(`worktree remove --force ${quote(workspace.path)}`);
    }

    await this.deleteBranchIfPresent(workspace.branch);
    await this.git("worktree prune");
  }

  private async assertCommittedHead(): Promise<void> {
    const result = await this.shell.run({
      command: "git rev-parse --verify HEAD",
      cwd: this.repoPath
    });

    if (result.status !== "passed") {
      throw new Error(
        "Repository must have a committed HEAD before creating a git worktree."
      );
    }
  }

  private async git(command: string, cwd = this.repoPath) {
    const result = await this.shell.run({
      command: `git ${command}`,
      cwd
    });

    if (result.status !== "passed") {
      throw new Error(result.stderr || result.stdout || `git ${command} failed`);
    }

    return result;
  }

  private async deleteBranchIfPresent(branch: string): Promise<void> {
    const branchList = await this.git(`branch --list ${quote(branch)}`);

    if (!branchList.stdout.trim()) {
      return;
    }

    await this.git(`branch -D ${quote(branch)}`);
  }
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "run"
  );
}

function quote(value: string): string {
  return JSON.stringify(value);
}
