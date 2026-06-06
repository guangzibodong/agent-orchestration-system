import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RunStore } from "./file-run-store.js";
import { ShellAdapter } from "./shell-adapter.js";
import { LocalRunner, type LocalWorkflowRun } from "./local-runner.js";

const node = JSON.stringify(process.execPath);
const shell = new ShellAdapter();
const tempRoots: string[] = [];

async function run(command: string, cwd: string) {
  const result = await shell.run({ command, cwd });

  if (result.status !== "passed") {
    throw new Error(result.stderr || result.stdout || `Command failed: ${command}`);
  }

  return result;
}

async function createCommittedRepo() {
  const repoPath = await mkdtemp(join(tmpdir(), "mawo-local-runner-test-"));
  tempRoots.push(repoPath);

  await run("git init -b main", repoPath);
  await run('git config user.email "test@example.com"', repoPath);
  await run('git config user.name "MAWO Test"', repoPath);
  await writeFile(join(repoPath, "README.md"), "initial\n", "utf8");
  await run("git add README.md", repoPath);
  await run('git commit -m "initial commit"', repoPath);

  return repoPath;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("LocalRunner", () => {
  it("hydrates workflows from asynchronous run stores before serving reads", async () => {
    const persistedRun: LocalWorkflowRun = {
      id: "persisted-workflow",
      goal: "Restore async workflow state",
      status: "needs_review",
      executionMode: "direct",
      createdAt: "2026-06-05T00:00:00.000Z",
      updatedAt: "2026-06-05T00:01:00.000Z",
      tasks: [],
      qualityGates: []
    };
    const store = {
      async list() {
        await delay(5);
        return [persistedRun];
      },
      async save() {
        await delay(5);
      }
    } as RunStore;
    const runner = new LocalRunner(undefined, {
      runStore: store
    });

    expect(runner.getWorkflow(persistedRun.id)).toBeUndefined();

    await runner.ready();

    expect(runner.getWorkflow(persistedRun.id)).toEqual(persistedRun);
  });

  it("refreshes workflow state written by another runner through the run store", async () => {
    const persistedRun: LocalWorkflowRun = {
      id: "shared-workflow",
      goal: "External worker state",
      status: "ready",
      executionMode: "direct",
      createdAt: "2026-06-05T00:00:00.000Z",
      updatedAt: "2026-06-05T00:01:00.000Z",
      tasks: [
        {
          id: "implement",
          title: "Implement",
          agent: "shell",
          command: "echo ok",
          status: "waiting"
        }
      ],
      qualityGates: []
    };
    const externallyUpdatedRun: LocalWorkflowRun = {
      ...persistedRun,
      status: "needs_review",
      updatedAt: "2026-06-05T00:02:00.000Z",
      tasks: [
        {
          ...persistedRun.tasks[0]!,
          status: "passed"
        }
      ]
    };
    let storedRuns = [persistedRun];
    const store = {
      list() {
        return storedRuns;
      },
      save(run: LocalWorkflowRun) {
        storedRuns = [run];
      }
    } as RunStore;
    const runner = new LocalRunner(undefined, { runStore: store });

    await runner.ready();
    expect(runner.getWorkflow(persistedRun.id)?.status).toBe("ready");

    storedRuns = [externallyUpdatedRun];
    await runner.refreshFromStore();

    expect(runner.getWorkflow(persistedRun.id)).toEqual(externallyUpdatedRun);
    expect(runner.listWorkflows()).toEqual([externallyUpdatedRun]);
  });

  it("runs workflow tasks and quality gates into a review-ready report", async () => {
    const runner = new LocalRunner();

    const run = runner.createWorkflow({
      goal: "Prove the local runner loop",
      tasks: [
        {
          id: "plan",
          title: "Plan work",
          agent: "shell",
          command: `${node} -e "console.log('planned')"`
        },
        {
          id: "verify",
          title: "Verify work",
          agent: "shell",
          dependsOn: ["plan"],
          command: `${node} -e "console.log('verified')"`
        }
      ],
      qualityGates: [
        {
          id: "unit",
          title: "Unit tests",
          command: `${node} -e "console.log('tests passed')"`
        }
      ]
    });

    const completed = await runner.runWorkflow(run.id);
    const report = runner.getReport(run.id);

    expect(completed.status).toBe("needs_review");
    expect(completed.tasks.map((task) => task.status)).toEqual([
      "passed",
      "passed"
    ]);
    expect(completed.qualityGates.map((gate) => gate.status)).toEqual([
      "passed"
    ]);
    expect(report.summary).toContain("2/2 tasks passed");
    expect(report.summary).toContain("1/1 gates passed");
    expect(report.recommendation).toBe("ready_for_review");
  });

  it("emits task and gate lifecycle events while running workflows", async () => {
    const events: Array<{
      type: string;
      workflowId: string;
      taskId?: string;
      gateId?: string;
      status?: string;
    }> = [];
    const runner = new LocalRunner(undefined, {
      eventSink: (event) => {
        events.push(event);
      }
    });

    const run = runner.createWorkflow({
      goal: "Audit lifecycle events",
      tasks: [
        {
          id: "plan",
          title: "Plan",
          agent: "shell",
          command: `${node} -e "console.log('planned')"`
        }
      ],
      qualityGates: [
        {
          id: "unit",
          title: "Unit",
          command: `${node} -e "console.log('unit ok')"`
        }
      ]
    });

    await runner.runWorkflow(run.id);

    expect(events).toEqual([
      expect.objectContaining({
        type: "workflow.task_started",
        workflowId: run.id,
        taskId: "plan"
      }),
      expect.objectContaining({
        type: "workflow.task_completed",
        workflowId: run.id,
        taskId: "plan",
        status: "passed"
      }),
      expect.objectContaining({
        type: "workflow.gate_started",
        workflowId: run.id,
        gateId: "unit"
      }),
      expect.objectContaining({
        type: "workflow.gate_completed",
        workflowId: run.id,
        gateId: "unit",
        status: "passed"
      })
    ]);
  });

  it("stops on a failed quality gate and reports the failure", async () => {
    const runner = new LocalRunner();

    const run = runner.createWorkflow({
      goal: "Catch gate failures",
      tasks: [
        {
          id: "task",
          title: "Do work",
          agent: "shell",
          command: `${node} -e "console.log('done')"`
        }
      ],
      qualityGates: [
        {
          id: "lint",
          title: "Lint",
          command: `${node} -e "console.error('lint failed'); process.exit(2)"`
        }
      ]
    });

    const completed = await runner.runWorkflow(run.id);
    const report = runner.getReport(run.id);

    expect(completed.status).toBe("gate_failed");
    expect(completed.qualityGates[0]?.status).toBe("failed");
    expect(report.recommendation).toBe("fix_failed_gates");
    expect(report.failedGates).toEqual(["lint"]);
  });

  it("fails workflow tasks that exceed their timeout", async () => {
    const runner = new LocalRunner();

    const run = runner.createWorkflow({
      goal: "Bound task runtime",
      tasks: [
        {
          id: "slow-task",
          title: "Slow task",
          agent: "shell",
          command: `${node} -e "setTimeout(() => console.log('too late'), 5000)"`,
          timeoutMs: 50
        }
      ],
      qualityGates: []
    });

    const completed = await runner.runWorkflow(run.id);
    const report = runner.getReport(run.id);

    expect(completed.status).toBe("failed");
    expect(completed.tasks[0]?.status).toBe("failed");
    expect(completed.tasks[0]?.result?.metadata?.timedOut).toBe("true");
    expect(report.recommendation).toBe("fix_failed_tasks");
  });

  it("fails quality gates that exceed their timeout", async () => {
    const runner = new LocalRunner();

    const run = runner.createWorkflow({
      goal: "Bound gate runtime",
      tasks: [
        {
          id: "task",
          title: "Task",
          agent: "shell",
          command: `${node} -e "console.log('done')"`
        }
      ],
      qualityGates: [
        {
          id: "slow-gate",
          title: "Slow gate",
          command: `${node} -e "setTimeout(() => console.log('too late'), 5000)"`,
          timeoutMs: 50
        }
      ]
    });

    const completed = await runner.runWorkflow(run.id);
    const report = runner.getReport(run.id);

    expect(completed.status).toBe("gate_failed");
    expect(completed.qualityGates[0]?.status).toBe("failed");
    expect(completed.qualityGates[0]?.result?.metadata?.timedOut).toBe("true");
    expect(report.recommendation).toBe("fix_failed_gates");
  });

  it("resets a failed workflow so it can run again", async () => {
    const root = await mkdtemp(join(tmpdir(), "mawo-retry-test-"));
    tempRoots.push(root);
    const counterPath = join(root, "attempts.txt").replace(/\\/g, "\\\\");
    const runner = new LocalRunner();

    const run = runner.createWorkflow({
      goal: "Retry transient task failures",
      tasks: [
        {
          id: "flaky-task",
          title: "Flaky task",
          agent: "shell",
          command: `${node} -e "const fs = require('fs'); const p = '${counterPath}'; const n = fs.existsSync(p) ? Number(fs.readFileSync(p, 'utf8')) + 1 : 1; fs.writeFileSync(p, String(n)); console.log('attempt ' + n); if (n < 2) process.exit(7);"`
        }
      ],
      qualityGates: [
        {
          id: "unit",
          title: "Unit tests",
          command: `${node} -e "console.log('tests passed')"`
        }
      ]
    });

    const failed = await runner.runWorkflow(run.id);
    expect(failed.status).toBe("failed");

    const retried = await runner.retryWorkflow(run.id);
    expect(retried.status).toBe("ready");
    expect(retried.review).toBeUndefined();
    expect(retried.tasks[0]?.status).toBe("waiting");
    expect(retried.tasks[0]?.result).toBeUndefined();
    expect(retried.tasks[0]?.workspace).toBeUndefined();
    expect(retried.tasks[0]?.diff).toBeUndefined();
    expect(retried.qualityGates[0]?.status).toBe("waiting");
    expect(retried.qualityGates[0]?.result).toBeUndefined();

    const completed = await runner.runWorkflow(run.id);

    expect(completed.status).toBe("needs_review");
    expect(completed.tasks[0]?.result?.stdout).toContain("attempt 2");
    expect(completed.qualityGates[0]?.status).toBe("passed");
  });

  it("cleans stale worktree workspaces before retrying failed workflows", async () => {
    const repoPath = await createCommittedRepo();
    const runner = new LocalRunner();

    const run = runner.createWorkflow({
      goal: "Retry should not orphan failed worktrees",
      executionMode: "worktree",
      repositoryPath: repoPath,
      tasks: [
        {
          id: "failed-edit",
          title: "Failed edit",
          agent: "shell",
          command: `${node} -e "const fs = require('fs'); fs.appendFileSync('README.md', 'failed edit\\\\n'); process.exit(7)"`
        }
      ],
      qualityGates: []
    });

    const failed = await runner.runWorkflow(run.id);
    const workspacePath = failed.tasks[0]?.workspace?.path;
    const branch = failed.tasks[0]?.workspace?.branch;

    expect(failed.status).toBe("failed");
    expect(workspacePath).toBeTruthy();
    expect(branch).toBeTruthy();
    expect(existsSync(workspacePath ?? "")).toBe(true);

    const retry = await runner.retryWorkflowWithResult(run.id);
    const retried = retry.run;
    const branchCheck = await shell.run({
      command: `git branch --list ${JSON.stringify(branch)}`,
      cwd: repoPath
    });

    expect(retry.previousStatus).toBe("failed");
    expect(retry.cleanedWorkspaces).toEqual([
      {
        taskId: "failed-edit",
        path: workspacePath,
        branch
      }
    ]);
    expect(retried.status).toBe("ready");
    expect(existsSync(workspacePath ?? "")).toBe(false);
    expect(branchCheck.stdout.trim()).toBe("");
    expect(retried.tasks[0]?.workspace).toBeUndefined();
    expect(retried.tasks[0]?.diff).toBeUndefined();
  });

  it("runs tasks inside git worktrees and includes diff artifacts in the report", async () => {
    const repoPath = await createCommittedRepo();
    const runner = new LocalRunner();

    const run = runner.createWorkflow({
      goal: "Capture task patch",
      executionMode: "worktree",
      repositoryPath: repoPath,
      tasks: [
        {
          id: "edit-readme",
          title: "Edit README",
          agent: "shell",
          command: `${node} -e "const fs = require('fs'); fs.appendFileSync('README.md', 'agent edit\\\\n')"`
        }
      ],
      qualityGates: []
    });

    const completed = await runner.runWorkflow(run.id);
    const report = runner.getReport(run.id);

    expect(completed.status).toBe("needs_review");
    expect(completed.tasks[0]?.workspace?.path).toContain("edit-readme");
    expect(completed.tasks[0]?.diff?.patch).toContain("+agent edit");
    expect(report.taskResults[0]?.workspacePath).toContain("edit-readme");
    expect(report.taskResults[0]?.patch).toContain("+agent edit");
  });

  it("runs configured CLI agent tasks inside worktrees and captures their patch", async () => {
    const repoPath = await createCommittedRepo();
    const runner = new LocalRunner(undefined, {
      cliAgents: [
        {
          id: "fake-agent",
          label: "Fake Agent",
          commandTemplate: `${node} {promptFile}`
        }
      ]
    });

    const run = runner.createWorkflow({
      goal: "Let a CLI agent edit README",
      executionMode: "worktree",
      repositoryPath: repoPath,
      tasks: [
        {
          id: "agent-edit",
          title: "Agent edit",
          agent: "fake-agent",
          instructions:
            "const fs = require('fs'); fs.appendFileSync('README.md', 'cli agent edit\\\\n'); console.log('agent wrote patch');"
        }
      ],
      qualityGates: []
    });

    const completed = await runner.runWorkflow(run.id);
    const report = runner.getReport(run.id);

    expect(completed.status).toBe("needs_review");
    expect(completed.tasks[0]?.result?.metadata?.agentId).toBe("fake-agent");
    expect(completed.tasks[0]?.result?.stdout).toContain("agent wrote patch");
    expect(completed.tasks[0]?.diff?.patch).toContain("+cli agent edit");
    expect(completed.tasks[0]?.diff?.patch).not.toContain(".mawo-prompts");
    expect(report.taskResults[0]?.agentId).toBe("fake-agent");
    expect(report.taskResults[0]?.patch).toContain("+cli agent edit");
    expect(report.taskResults[0]?.patch).not.toContain(".mawo-prompts");
  });

  it("creates a merge candidate from passed worktree task patches", async () => {
    const repoPath = await createCommittedRepo();
    const runner = new LocalRunner();

    const run = runner.createWorkflow({
      goal: "Create a merge candidate",
      executionMode: "worktree",
      repositoryPath: repoPath,
      tasks: [
        {
          id: "edit-readme",
          title: "Edit README",
          agent: "shell",
          command: `${node} -e "const fs = require('fs'); fs.appendFileSync('README.md', 'candidate patch\\\\n')"`
        }
      ],
      qualityGates: []
    });

    await runner.runWorkflow(run.id);
    const candidate = runner.getMergeCandidate(run.id);

    expect(candidate.status).toBe("ready");
    expect(candidate.summary).toContain("1 task patch");
    expect(candidate.sourceBranches[0]).toContain("edit-readme");
    expect(candidate.patch).toContain("+candidate patch");
  });

  it("blocks merge candidates when quality gates fail after a task patch", async () => {
    const repoPath = await createCommittedRepo();
    const runner = new LocalRunner();

    const run = runner.createWorkflow({
      goal: "Do not suggest patches when gates fail",
      executionMode: "worktree",
      repositoryPath: repoPath,
      tasks: [
        {
          id: "edit-readme",
          title: "Edit README",
          agent: "shell",
          command: `${node} -e "const fs = require('fs'); fs.appendFileSync('README.md', 'blocked candidate patch\\\\n')"`
        }
      ],
      qualityGates: [
        {
          id: "unit",
          title: "Unit tests",
          command: `${node} -e "process.exit(8)"`
        }
      ]
    });

    const completed = await runner.runWorkflow(run.id);

    expect(completed.status).toBe("gate_failed");
    expect(completed.tasks[0]?.diff?.patch).toContain("+blocked candidate patch");
    expect(() => runner.getMergeCandidate(run.id)).toThrow(
      "Workflow is gate_failed; merge candidate requires review-ready work."
    );
  });

  it("cleans worktree workspaces only after workflow review is completed", async () => {
    const repoPath = await createCommittedRepo();
    const runner = new LocalRunner();

    const run = runner.createWorkflow({
      goal: "Clean completed worktree workspaces",
      executionMode: "worktree",
      repositoryPath: repoPath,
      tasks: [
        {
          id: "edit-readme",
          title: "Edit README",
          agent: "shell",
          command: `${node} -e "const fs = require('fs'); fs.appendFileSync('README.md', 'cleanup patch\\\\n')"`
        }
      ],
      qualityGates: []
    });

    const reviewReady = await runner.runWorkflow(run.id);
    const workspacePath = reviewReady.tasks[0]?.workspace?.path;
    const branch = reviewReady.tasks[0]?.workspace?.branch;

    expect(workspacePath).toBeTruthy();
    expect(branch).toBeTruthy();
    expect(existsSync(workspacePath ?? "")).toBe(true);
    await expect(runner.cleanupWorkflowWorkspaces(run.id)).rejects.toThrow(
      "Workflow is needs_review"
    );

    runner.reviewWorkflow(run.id, { decision: "approve" });
    const cleanup = await runner.cleanupWorkflowWorkspaces(run.id);
    const secondCleanup = await runner.cleanupWorkflowWorkspaces(run.id);
    const cleanedWorkflow = runner.getWorkflow(run.id);
    const branchCheck = await shell.run({
      command: `git branch --list ${JSON.stringify(branch)}`,
      cwd: repoPath
    });

    expect(cleanup).toMatchObject({
      workflowId: run.id,
      status: "cleaned"
    });
    expect(cleanup.cleaned).toEqual([
      expect.objectContaining({
        taskId: "edit-readme",
        path: workspacePath,
        branch
      })
    ]);
    expect(existsSync(workspacePath ?? "")).toBe(false);
    expect(branchCheck.stdout.trim()).toBe("");
    expect(cleanedWorkflow?.tasks[0]?.workspace).toBeUndefined();
    expect(secondCleanup).toMatchObject({
      workflowId: run.id,
      status: "empty",
      cleaned: []
    });
  });

  it("previews workspace cleanup readiness before deleting worktrees", async () => {
    const repoPath = await createCommittedRepo();
    const runner = new LocalRunner();

    const run = runner.createWorkflow({
      goal: "Preview worktree cleanup",
      executionMode: "worktree",
      repositoryPath: repoPath,
      tasks: [
        {
          id: "edit-readme",
          title: "Edit README",
          agent: "shell",
          command: `${node} -e "const fs = require('fs'); fs.appendFileSync('README.md', 'preview cleanup\\\\n')"`
        }
      ],
      qualityGates: []
    });

    const reviewReady = await runner.runWorkflow(run.id);
    const workspacePath = reviewReady.tasks[0]?.workspace?.path;
    const blockedPreview = runner.getWorkspaceCleanupPreview(run.id);

    expect(blockedPreview).toMatchObject({
      workflowId: run.id,
      workflowStatus: "needs_review",
      cleanupAllowed: false,
      workspaceCount: 1,
      existingCount: 1,
      blockedReason:
        "Workflow is needs_review; workspaces can only be cleaned after completion or abort."
    });
    expect(blockedPreview.workspaces).toEqual([
      expect.objectContaining({
        taskId: "edit-readme",
        taskTitle: "Edit README",
        path: workspacePath,
        branch: expect.stringContaining("edit-readme"),
        repoPath,
        exists: true,
        cleanupAllowed: false
      })
    ]);

    runner.reviewWorkflow(run.id, { decision: "approve" });
    const allowedPreview = runner.getWorkspaceCleanupPreview(run.id);

    expect(allowedPreview.cleanupAllowed).toBe(true);
    expect(allowedPreview.blockedReason).toBeUndefined();
    expect(allowedPreview.workspaces[0]?.cleanupAllowed).toBe(true);

    await runner.cleanupWorkflowWorkspaces(run.id);
    const emptyPreview = runner.getWorkspaceCleanupPreview(run.id);

    expect(emptyPreview).toMatchObject({
      workflowId: run.id,
      workflowStatus: "completed",
      cleanupAllowed: true,
      workspaceCount: 0,
      existingCount: 0,
      workspaces: []
    });
  });
});
