import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileJobStore } from "./file-job-store.js";
import { LocalRunner } from "./local-runner.js";
import { WorkflowJobQueue } from "./workflow-job-queue.js";

const node = JSON.stringify(process.execPath);
const tempRoots: string[] = [];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe("WorkflowJobQueue", () => {
  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    for (const root of tempRoots.splice(0)) {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("enqueues workflow runs and completes them in the background", async () => {
    const runner = new LocalRunner();
    const queue = new WorkflowJobQueue({ runner });
    const run = runner.createWorkflow({
      goal: "Run through the queue",
      tasks: [
        {
          id: "task",
          title: "Queued task",
          agent: "shell",
          command: `${node} -e "console.log('queued task')"`
        }
      ],
      qualityGates: []
    });

    const job = queue.enqueue(run.id);

    expect(job.status).toBe("queued");
    expect(queue.getJob(job.id)?.workflowId).toBe(run.id);

    const completed = await queue.waitForJob(job.id, 5000);

    expect(completed.status).toBe("completed");
    expect(runner.getWorkflow(run.id)?.status).toBe("needs_review");
  });

  it("persists completed jobs across queue instances", async () => {
    const root = await mkdtemp(join(tmpdir(), "mawo-job-store-test-"));
    tempRoots.push(root);
    const stateFile = join(root, "jobs.json");
    const runner = new LocalRunner();
    const store = new FileJobStore({ stateFile });
    const queue = new WorkflowJobQueue({ runner, jobStore: store });
    const run = runner.createWorkflow({
      goal: "Persist queued job history",
      tasks: [
        {
          id: "task",
          title: "Queued task",
          agent: "shell",
          command: `${node} -e "console.log('persisted job')"`
        }
      ],
      qualityGates: []
    });

    const job = queue.enqueue(run.id);
    const completed = await queue.waitForJob(job.id, 5000);
    const restoredQueue = new WorkflowJobQueue({
      runner,
      jobStore: new FileJobStore({ stateFile })
    });

    expect(completed.status).toBe("completed");
    expect(restoredQueue.getJob(job.id)).toMatchObject({
      id: job.id,
      workflowId: run.id,
      status: "completed"
    });
    expect(restoredQueue.listJobs().map((restored) => restored.id)).toContain(job.id);
  });

  it("marks persisted non-terminal jobs failed on queue startup", async () => {
    const root = await mkdtemp(join(tmpdir(), "mawo-job-recover-test-"));
    tempRoots.push(root);
    const stateFile = join(root, "jobs.json");
    await writeFile(
      stateFile,
      JSON.stringify(
        [
          {
            id: "queued-job",
            workflowId: "workflow-1",
            status: "queued",
            createdAt: "2026-06-05T00:00:00.000Z",
            updatedAt: "2026-06-05T00:00:00.000Z"
          },
          {
            id: "running-job",
            workflowId: "workflow-2",
            status: "running",
            createdAt: "2026-06-05T00:00:00.000Z",
            updatedAt: "2026-06-05T00:00:01.000Z",
            startedAt: "2026-06-05T00:00:01.000Z"
          }
        ],
        null,
        2
      ),
      "utf8"
    );

    const queue = new WorkflowJobQueue({
      runner: new LocalRunner(),
      jobStore: new FileJobStore({ stateFile })
    });

    expect(queue.getJob("queued-job")).toMatchObject({
      status: "failed",
      error: "Job was interrupted by API restart."
    });
    expect(queue.getJob("running-job")).toMatchObject({
      status: "failed",
      error: "Job was interrupted by API restart."
    });
    expect(new FileJobStore({ stateFile }).list()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "queued-job", status: "failed" }),
        expect.objectContaining({ id: "running-job", status: "failed" })
      ])
    );
  });

  it("notifies operators when persisted active jobs are recovered as failed", async () => {
    const root = await mkdtemp(join(tmpdir(), "mawo-job-recovery-notice-test-"));
    tempRoots.push(root);
    const stateFile = join(root, "jobs.json");
    await writeFile(
      stateFile,
      JSON.stringify(
        [
          {
            id: "running-job",
            workflowId: "workflow-2",
            status: "running",
            createdAt: "2026-06-05T00:00:00.000Z",
            updatedAt: "2026-06-05T00:00:01.000Z",
            startedAt: "2026-06-05T00:00:01.000Z"
          }
        ],
        null,
        2
      ),
      "utf8"
    );
    const recoveredJobs: Array<{
      before: string;
      after: string;
      jobId: string;
      workflowId: string;
    }> = [];

    new WorkflowJobQueue({
      runner: new LocalRunner(),
      jobStore: new FileJobStore({ stateFile }),
      onJobRecovered: ({ original, recovered }) => {
        recoveredJobs.push({
          before: original.status,
          after: recovered.status,
          jobId: recovered.id,
          workflowId: recovered.workflowId
        });
      }
    });

    expect(recoveredJobs).toEqual([
      {
        before: "running",
        after: "failed",
        jobId: "running-job",
        workflowId: "workflow-2"
      }
    ]);
  });

  it("rejects duplicate jobs while a workflow already has an active job", async () => {
    vi.useFakeTimers();
    const runner = new LocalRunner();
    const queue = new WorkflowJobQueue({ runner });
    const run = runner.createWorkflow({
      goal: "Prevent duplicate active jobs",
      tasks: [
        {
          id: "task",
          title: "Queued task",
          agent: "shell",
          command: `${node} -e "console.log('queued task')"`
        }
      ],
      qualityGates: []
    });

    const job = queue.enqueue(run.id);

    expect(() => queue.enqueue(run.id)).toThrow(
      `Workflow ${run.id} already has an active job ${job.id}`
    );

    const canceled = queue.cancelJob(job.id);
    const nextJob = queue.enqueue(run.id);
    await vi.runAllTimersAsync();

    expect(canceled?.status).toBe("canceled");
    expect(nextJob.workflowId).toBe(run.id);
    expect(nextJob.id).not.toBe(job.id);
  });

  it("rejects duplicate jobs while a workflow job is running", async () => {
    const runner = new LocalRunner();
    const queue = new WorkflowJobQueue({ runner });
    const run = runner.createWorkflow({
      goal: "Prevent duplicate running jobs",
      tasks: [
        {
          id: "slow-task",
          title: "Slow task",
          agent: "shell",
          command: `${node} -e "setTimeout(() => console.log('done'), 1200)"`
        }
      ],
      qualityGates: []
    });

    const job = queue.enqueue(run.id);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (queue.getJob(job.id)?.status === "running") {
        break;
      }
      await delay(25);
    }

    expect(queue.getJob(job.id)?.status).toBe("running");
    expect(() => queue.enqueue(run.id)).toThrow(
      `Workflow ${run.id} already has an active job ${job.id}`
    );

    queue.cancelJob(job.id);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (runner.getWorkflow(run.id)?.status === "aborted") {
        break;
      }
      await delay(25);
    }

    const nextJob = queue.enqueue(run.id);
    queue.cancelJob(nextJob.id);

    expect(nextJob.id).not.toBe(job.id);
  });

  it("marks jobs failed when the runner cannot find a workflow", async () => {
    const runner = new LocalRunner();
    const queue = new WorkflowJobQueue({ runner });

    const job = queue.enqueue("missing-workflow");
    const completed = await queue.waitForJob(job.id, 5000);

    expect(completed.status).toBe("failed");
    expect(completed.error).toContain("Workflow not found");
  });

  it("cancels queued jobs without running the workflow", async () => {
    vi.useFakeTimers();
    const runner = new LocalRunner();
    const runWorkflow = vi.spyOn(runner, "runWorkflow");
    const queue = new WorkflowJobQueue({ runner });
    const run = runner.createWorkflow({
      goal: "Cancel before running",
      tasks: [
        {
          id: "task",
          title: "Should not run",
          agent: "shell",
          command: `${node} -e "console.log('should not run')"`
        }
      ],
      qualityGates: []
    });

    const job = queue.enqueue(run.id);
    const canceled = (
      queue as unknown as {
        cancelJob(id: string): ReturnType<WorkflowJobQueue["getJob"]>;
      }
    ).cancelJob(job.id);

    await vi.runAllTimersAsync();

    expect(canceled?.status).toBe("canceled");
    expect(queue.getJob(job.id)?.status).toBe("canceled");
    expect(runWorkflow).not.toHaveBeenCalled();
    expect(runner.getWorkflow(run.id)?.status).toBe("ready");
  });

  it("aborts a running workflow when its job is canceled", async () => {
    const root = await mkdtemp(join(tmpdir(), "mawo-job-abort-test-"));
    tempRoots.push(root);
    const markerPath = join(root, "done.txt");
    const runner = new LocalRunner();
    const queue = new WorkflowJobQueue({ runner });
    const run = runner.createWorkflow({
      goal: "Abort a running queued workflow",
      tasks: [
        {
          id: "slow-task",
          title: "Slow task",
          agent: "shell",
          command: `${node} -e "setTimeout(() => require('fs').writeFileSync(process.argv[1], 'done'), 1200)" ${JSON.stringify(markerPath)}`
        }
      ],
      qualityGates: []
    });

    const job = queue.enqueue(run.id);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (queue.getJob(job.id)?.status === "running") {
        break;
      }
      await delay(25);
    }

    expect(queue.getJob(job.id)?.status).toBe("running");

    const canceled = queue.cancelJob(job.id);
    const settled = await queue.waitForJob(job.id, 5000);
    await delay(1400);

    const workflow = runner.getWorkflow(run.id);

    expect(canceled?.status).toBe("canceled");
    expect(settled.status).toBe("canceled");
    expect(queue.getJob(job.id)?.status).toBe("canceled");
    expect(workflow?.status).toBe("aborted");
    expect(workflow?.tasks[0]?.status).toBe("canceled");
    expect(workflow?.tasks[0]?.result?.metadata?.canceled).toBe("true");
    expect(existsSync(markerPath)).toBe(false);
  });
});
