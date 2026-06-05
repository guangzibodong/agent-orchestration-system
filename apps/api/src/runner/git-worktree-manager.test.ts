import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ShellAdapter } from "./shell-adapter.js";
import { GitWorktreeManager } from "./git-worktree-manager.js";

const shell = new ShellAdapter();
const node = JSON.stringify(process.execPath);
const tempRoots: string[] = [];

async function run(command: string, cwd: string) {
  const result = await shell.run({ command, cwd });

  if (result.status !== "passed") {
    throw new Error(result.stderr || result.stdout || `Command failed: ${command}`);
  }

  return result;
}

async function createCommittedRepo() {
  const repoPath = await mkdtemp(join(tmpdir(), "mawo-worktree-test-"));
  tempRoots.push(repoPath);

  await run("git init -b main", repoPath);
  await run('git config user.email "test@example.com"', repoPath);
  await run('git config user.name "MAWO Test"', repoPath);
  await writeFile(join(repoPath, "README.md"), "initial\n", "utf8");
  await run("git add README.md", repoPath);
  await run('git commit -m "initial commit"', repoPath);

  return repoPath;
}

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("GitWorktreeManager", () => {
  it("creates an isolated worktree and captures modified and untracked files", async () => {
    const repoPath = await createCommittedRepo();
    const manager = new GitWorktreeManager({
      repoPath,
      worktreeRoot: join(repoPath, ".mawo", "worktrees")
    });

    const workspace = await manager.createWorkspace({
      workflowId: "run one",
      taskId: "task/one"
    });

    await run(
      `${node} -e "const fs = require('fs'); fs.appendFileSync('README.md', 'changed\\\\n'); fs.writeFileSync('feature.txt', 'new file\\\\n')"`,
      workspace.path
    );

    const artifact = await manager.collectDiff(workspace);

    expect(workspace.branch).toContain("mawo/run-one/task-one");
    expect(await readFile(join(workspace.path, "README.md"), "utf8")).toContain(
      "changed"
    );
    expect(artifact.status).toContain("M README.md");
    expect(artifact.status).toContain("?? feature.txt");
    expect(artifact.patch).toContain("+changed");
    expect(artifact.patch).toContain("+new file");
  });

  it("rejects repositories without a committed HEAD", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "mawo-empty-repo-test-"));
    tempRoots.push(repoPath);
    await run("git init -b main", repoPath);

    const manager = new GitWorktreeManager({ repoPath });

    await expect(
      manager.createWorkspace({
        workflowId: "run",
        taskId: "task"
      })
    ).rejects.toThrow("committed HEAD");
  });
});
