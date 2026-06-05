import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  CliAgentAdapter,
  type CliAgentConfig
} from "./cli-agent-adapter.js";
import {
  GitWorktreeManager,
  type DiffArtifact,
  type WorktreeWorkspace
} from "./git-worktree-manager.js";
import type { ArtifactStore } from "./file-artifact-store.js";
import type { RunStore } from "./file-run-store.js";
import { ShellAdapter, type ShellRunResult } from "./shell-adapter.js";

export type RunnerTaskStatus =
  | "waiting"
  | "running"
  | "blocked"
  | "passed"
  | "failed"
  | "canceled"
  | "reviewing";

export type RunnerWorkflowStatus =
  | "draft"
  | "ready"
  | "running"
  | "gate_failed"
  | "needs_review"
  | "completed"
  | "aborted"
  | "archived"
  | "failed";

export type WorkflowTaskDefinition = {
  id: string;
  title: string;
  agent: string;
  command?: string;
  instructions?: string;
  cwd?: string;
  timeoutMs?: number;
  dependsOn?: string[];
};

export type QualityGateDefinition = {
  id: string;
  title: string;
  command: string;
  cwd?: string;
  timeoutMs?: number;
};

export type WorkflowDefinition = {
  goal: string;
  executionMode?: "direct" | "worktree";
  repositoryId?: string;
  repositoryPath?: string;
  worktreeRoot?: string;
  tasks: WorkflowTaskDefinition[];
  qualityGates: QualityGateDefinition[];
};

export type WorkflowReviewDecision = "approve" | "reject";

export type WorkflowReviewRecord = {
  decision: "approved" | "rejected";
  note?: string;
  reviewedAt: string;
};

export type TaskRunRecord = WorkflowTaskDefinition & {
  status: RunnerTaskStatus;
  result?: ShellRunResult;
  workspace?: WorktreeWorkspace;
  diff?: DiffArtifact;
};

export type QualityGateRunRecord = QualityGateDefinition & {
  status: RunnerTaskStatus;
  result?: ShellRunResult;
};

export type LocalWorkflowRun = {
  id: string;
  goal: string;
  status: RunnerWorkflowStatus;
  executionMode: "direct" | "worktree";
  repositoryId?: string;
  repositoryPath?: string;
  worktreeRoot?: string;
  createdAt: string;
  updatedAt: string;
  review?: WorkflowReviewRecord;
  tasks: TaskRunRecord[];
  qualityGates: QualityGateRunRecord[];
};

export type RunReport = {
  workflowId: string;
  reportArtifactPath?: string;
  summary: string;
  recommendation: "ready_for_review" | "fix_failed_tasks" | "fix_failed_gates";
  failedTasks: string[];
  failedGates: string[];
  taskResults: Array<{
    id: string;
    title: string;
    status: RunnerTaskStatus;
    agentId?: string;
    agentLabel?: string;
    promptFile?: string;
    exitCode?: number;
    stdout?: string;
    stderr?: string;
    workspacePath?: string;
    branch?: string;
    gitStatus?: string;
    patch?: string;
    stdoutArtifactPath?: string;
    stderrArtifactPath?: string;
    gitStatusArtifactPath?: string;
    patchArtifactPath?: string;
  }>;
  gateResults: Array<{
    id: string;
    title: string;
    status: RunnerTaskStatus;
    exitCode?: number;
    stdout?: string;
    stderr?: string;
    stdoutArtifactPath?: string;
    stderrArtifactPath?: string;
  }>;
};

export type MergeCandidate = {
  workflowId: string;
  status: "ready" | "empty";
  summary: string;
  sourceBranches: string[];
  patch: string;
  patchArtifactPath?: string;
  manifestArtifactPath?: string;
  applyCommand?: string;
  createdAt: string;
};

export type WorkspaceCleanupItem = {
  taskId: string;
  path: string;
  branch: string;
};

export type WorkspaceCleanupResult = {
  workflowId: string;
  status: "cleaned" | "empty";
  cleanedAt: string;
  cleaned: WorkspaceCleanupItem[];
};

export type WorkspaceCleanupPreviewItem = WorkspaceCleanupItem & {
  taskTitle: string;
  repoPath: string;
  exists: boolean;
  cleanupAllowed: boolean;
};

export type WorkspaceCleanupPreview = {
  workflowId: string;
  workflowStatus: RunnerWorkflowStatus;
  cleanupAllowed: boolean;
  blockedReason?: string;
  workspaceCount: number;
  existingCount: number;
  workspaces: WorkspaceCleanupPreviewItem[];
};

export type InterruptedWorkflowRecoveryResult = {
  recovered: boolean;
  workflowId: string;
  previousStatus?: RunnerWorkflowStatus;
  status?: RunnerWorkflowStatus;
  recoveredTasks: string[];
  recoveredGates: string[];
};

export type WorkflowRuntimeEvent = {
  type:
    | "workflow.task_started"
    | "workflow.task_completed"
    | "workflow.gate_started"
    | "workflow.gate_completed";
  workflowId: string;
  taskId?: string;
  gateId?: string;
  status?: RunnerTaskStatus;
  exitCode?: number;
  durationMs?: number;
};

export type LocalRunnerOptions = {
  cliAgents?: CliAgentConfig[];
  runStore?: RunStore;
  artifactStore?: ArtifactStore;
  eventSink?: (event: WorkflowRuntimeEvent) => void;
};

export type RunWorkflowOptions = {
  signal?: AbortSignal;
};

export class WorkflowNotReviewReadyError extends Error {
  constructor(status: RunnerWorkflowStatus) {
    super(`Workflow is ${status}, not needs_review.`);
    this.name = "WorkflowNotReviewReadyError";
  }
}

export class WorkflowNotRetryableError extends Error {
  constructor(status: RunnerWorkflowStatus) {
    super(`Workflow is ${status}, not retryable.`);
    this.name = "WorkflowNotRetryableError";
  }
}

export class WorkflowWorkspacesNotCleanableError extends Error {
  constructor(status: RunnerWorkflowStatus) {
    super(workspaceCleanupBlockedReason(status));
    this.name = "WorkflowWorkspacesNotCleanableError";
  }
}

export class LocalRunner {
  private readonly runs = new Map<string, LocalWorkflowRun>();
  private readonly shell: ShellAdapter;
  private readonly cliAgents = new Map<string, CliAgentAdapter>();
  private readonly runStore?: RunStore;
  private readonly artifactStore?: ArtifactStore;
  private readonly eventSink?: (event: WorkflowRuntimeEvent) => void;

  constructor(shell = new ShellAdapter(), options: LocalRunnerOptions = {}) {
    this.shell = shell;
    this.runStore = options.runStore;
    this.artifactStore = options.artifactStore;
    this.eventSink = options.eventSink;
    for (const config of options.cliAgents ?? []) {
      this.cliAgents.set(config.id, new CliAgentAdapter(config, this.shell));
    }
    for (const run of this.runStore?.list() ?? []) {
      this.runs.set(run.id, run);
    }
  }

  createWorkflow(definition: WorkflowDefinition): LocalWorkflowRun {
    const now = new Date().toISOString();
    const run: LocalWorkflowRun = {
      id: randomUUID(),
      goal: definition.goal,
      status: "ready",
      executionMode: definition.executionMode ?? "direct",
      repositoryId: definition.repositoryId,
      repositoryPath: definition.repositoryPath,
      worktreeRoot: definition.worktreeRoot,
      createdAt: now,
      updatedAt: now,
      tasks: definition.tasks.map((task) => ({
        ...task,
        status: "waiting"
      })),
      qualityGates: definition.qualityGates.map((gate) => ({
        ...gate,
        status: "waiting"
      }))
    };

    this.runs.set(run.id, run);
    this.persist(run);
    return run;
  }

  listWorkflows(): LocalWorkflowRun[] {
    return [...this.runs.values()];
  }

  getWorkflow(id: string): LocalWorkflowRun | undefined {
    return this.runs.get(id);
  }

  getMergeCandidate(id: string): MergeCandidate {
    const run = this.mustGetWorkflow(id);
    const patchTasks = run.tasks.filter(
      (task) =>
        task.status === "passed" &&
        task.diff?.patch &&
        task.diff.patch.trim().length > 0
    );
    const patch = patchTasks
      .map((task) => task.diff?.patch.trimEnd())
      .filter((value): value is string => Boolean(value))
      .join("\n\n");
    const patchCount = patchTasks.length;
    const candidate: MergeCandidate = {
      workflowId: run.id,
      status: patchCount > 0 ? "ready" : "empty",
      summary:
        patchCount > 0
          ? `${patchCount} task patch${patchCount === 1 ? "" : "es"} ready to apply`
          : "No task patches are available to apply",
      sourceBranches: patchTasks
        .map((task) => task.workspace?.branch)
        .filter((branch): branch is string => Boolean(branch)),
      patch,
      createdAt: new Date().toISOString()
    };

    return this.artifactStore?.persistMergeCandidate(run, candidate) ?? candidate;
  }

  async cleanupWorkflowWorkspaces(id: string): Promise<WorkspaceCleanupResult> {
    const run = this.mustGetWorkflow(id);

    if (!isWorkspaceCleanupAllowed(run.status)) {
      throw new WorkflowWorkspacesNotCleanableError(run.status);
    }

    const cleaned: WorkspaceCleanupItem[] = [];

    for (const task of run.tasks) {
      if (!task.workspace) {
        continue;
      }

      await new GitWorktreeManager({
        repoPath: task.workspace.repoPath,
        worktreeRoot: run.worktreeRoot,
        shell: this.shell
      }).removeWorkspace(task.workspace);

      cleaned.push({
        taskId: task.id,
        path: task.workspace.path,
        branch: task.workspace.branch
      });
      task.workspace = undefined;
    }

    this.persist(run);

    return {
      workflowId: run.id,
      status: cleaned.length > 0 ? "cleaned" : "empty",
      cleanedAt: new Date().toISOString(),
      cleaned
    };
  }

  getWorkspaceCleanupPreview(id: string): WorkspaceCleanupPreview {
    const run = this.mustGetWorkflow(id);
    const cleanupAllowed = isWorkspaceCleanupAllowed(run.status);
    const workspaces = run.tasks
      .filter((task) => Boolean(task.workspace))
      .map((task) => {
        const workspace = task.workspace!;
        const exists = existsSync(workspace.path);

        return {
          taskId: task.id,
          taskTitle: task.title,
          path: workspace.path,
          branch: workspace.branch,
          repoPath: workspace.repoPath,
          exists,
          cleanupAllowed: cleanupAllowed && exists
        };
      });

    return {
      workflowId: run.id,
      workflowStatus: run.status,
      cleanupAllowed,
      ...(cleanupAllowed
        ? {}
        : { blockedReason: workspaceCleanupBlockedReason(run.status) }),
      workspaceCount: workspaces.length,
      existingCount: workspaces.filter((workspace) => workspace.exists).length,
      workspaces
    };
  }

  recoverInterruptedWorkflow(
    id: string,
    reason: "api_restart" = "api_restart"
  ): InterruptedWorkflowRecoveryResult {
    const run = this.runs.get(id);

    if (!run || run.status !== "running") {
      return {
        recovered: false,
        workflowId: id,
        previousStatus: run?.status,
        status: run?.status,
        recoveredTasks: [],
        recoveredGates: []
      };
    }

    const recoveredTasks: string[] = [];
    const recoveredGates: string[] = [];

    for (const task of run.tasks) {
      if (task.status !== "running") {
        continue;
      }

      task.status = "canceled";
      task.result = createInterruptedResult(
        task.command ?? task.instructions ?? "",
        reason
      );
      recoveredTasks.push(task.id);
    }

    for (const gate of run.qualityGates) {
      if (gate.status !== "running") {
        continue;
      }

      gate.status = "canceled";
      gate.result = createInterruptedResult(gate.command, reason);
      recoveredGates.push(gate.id);
    }

    const previousStatus = run.status;
    this.updateStatus(run, "aborted");

    return {
      recovered: true,
      workflowId: run.id,
      previousStatus,
      status: run.status,
      recoveredTasks,
      recoveredGates
    };
  }

  reviewWorkflow(
    id: string,
    input: { decision: WorkflowReviewDecision; note?: string }
  ): LocalWorkflowRun {
    const run = this.mustGetWorkflow(id);

    if (run.status !== "needs_review") {
      throw new WorkflowNotReviewReadyError(run.status);
    }

    run.review = {
      decision: input.decision === "approve" ? "approved" : "rejected",
      note: input.note,
      reviewedAt: new Date().toISOString()
    };
    this.updateStatus(run, input.decision === "approve" ? "completed" : "failed");

    return run;
  }

  retryWorkflow(id: string): LocalWorkflowRun {
    const run = this.mustGetWorkflow(id);

    if (!["failed", "gate_failed", "aborted"].includes(run.status)) {
      throw new WorkflowNotRetryableError(run.status);
    }

    delete run.review;
    for (const task of run.tasks) {
      task.status = "waiting";
      delete task.result;
      delete task.workspace;
      delete task.diff;
    }
    for (const gate of run.qualityGates) {
      gate.status = "waiting";
      delete gate.result;
    }
    this.updateStatus(run, "ready");

    return run;
  }

  async runWorkflow(
    id: string,
    options: RunWorkflowOptions = {}
  ): Promise<LocalWorkflowRun> {
    const run = this.mustGetWorkflow(id);
    this.updateStatus(run, "running");

    for (const task of run.tasks) {
      if (options.signal?.aborted) {
        task.status = "canceled";
        task.result = createCanceledResult(task.command ?? task.instructions ?? "");
        run.updatedAt = new Date().toISOString();
        this.persist(run);
        this.updateStatus(run, "aborted");
        return run;
      }

      if (!this.dependenciesPassed(run, task.dependsOn ?? [])) {
        task.status = "blocked";
        this.updateStatus(run, "failed");
        return run;
      }

      task.status = "running";
      run.updatedAt = new Date().toISOString();
      this.persist(run);
      this.emitEvent({
        type: "workflow.task_started",
        workflowId: run.id,
        taskId: task.id
      });
      const workspace =
        run.executionMode === "worktree"
          ? await this.createTaskWorkspace(run, task)
          : undefined;
      const taskCwd = workspace ? resolveTaskCwd(workspace.path, task.cwd) : task.cwd;
      task.workspace = workspace;
      task.result = await this.runTask(run, task, taskCwd, options.signal);
      task.status = task.result.status;
      this.emitEvent({
        type: "workflow.task_completed",
        workflowId: run.id,
        taskId: task.id,
        status: task.status,
        exitCode: task.result.exitCode,
        durationMs: task.result.durationMs
      });

      if (workspace && task.status !== "canceled") {
        task.diff = await new GitWorktreeManager({
          repoPath: workspace.repoPath,
          worktreeRoot: run.worktreeRoot,
          shell: this.shell
        }).collectDiff(workspace);
      }

      run.updatedAt = new Date().toISOString();
      this.persist(run);

      if (task.status === "canceled") {
        this.updateStatus(run, "aborted");
        return run;
      }

      if (task.status === "failed") {
        this.updateStatus(run, "failed");
        return run;
      }
    }

    for (const gate of run.qualityGates) {
      if (options.signal?.aborted) {
        gate.status = "canceled";
        gate.result = createCanceledResult(gate.command);
        run.updatedAt = new Date().toISOString();
        this.persist(run);
        this.updateStatus(run, "aborted");
        return run;
      }

      gate.status = "running";
      run.updatedAt = new Date().toISOString();
      this.persist(run);
      this.emitEvent({
        type: "workflow.gate_started",
        workflowId: run.id,
        gateId: gate.id
      });
      gate.result = await this.shell.run({
        command: gate.command,
        cwd: gate.cwd ?? this.lastTaskWorkspacePath(run),
        timeoutMs: gate.timeoutMs,
        signal: options.signal
      });
      gate.status = gate.result.status;
      this.emitEvent({
        type: "workflow.gate_completed",
        workflowId: run.id,
        gateId: gate.id,
        status: gate.status,
        exitCode: gate.result.exitCode,
        durationMs: gate.result.durationMs
      });
      run.updatedAt = new Date().toISOString();
      this.persist(run);

      if (gate.status === "canceled") {
        this.updateStatus(run, "aborted");
        return run;
      }

      if (gate.status === "failed") {
        this.updateStatus(run, "gate_failed");
        return run;
      }
    }

    this.updateStatus(run, "needs_review");
    return run;
  }

  getReport(id: string): RunReport {
    const run = this.mustGetWorkflow(id);
    const failedTasks = run.tasks
      .filter(
        (task) =>
          task.status === "failed" ||
          task.status === "blocked" ||
          task.status === "canceled"
      )
      .map((task) => task.id);
    const failedGates = run.qualityGates
      .filter((gate) => gate.status === "failed" || gate.status === "canceled")
      .map((gate) => gate.id);
    const passedTasks = run.tasks.filter((task) => task.status === "passed");
    const passedGates = run.qualityGates.filter((gate) => gate.status === "passed");

    const report: RunReport = {
      workflowId: run.id,
      summary: `${passedTasks.length}/${run.tasks.length} tasks passed; ${passedGates.length}/${run.qualityGates.length} gates passed`,
      recommendation:
        failedTasks.length > 0
          ? "fix_failed_tasks"
          : failedGates.length > 0
            ? "fix_failed_gates"
            : "ready_for_review",
      failedTasks,
      failedGates,
      taskResults: run.tasks.map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        agentId: task.result?.metadata?.agentId,
        agentLabel: task.result?.metadata?.agentLabel,
        promptFile: task.result?.metadata?.promptFile,
        exitCode: task.result?.exitCode,
        stdout: task.result?.stdout,
        stderr: task.result?.stderr,
        workspacePath: task.workspace?.path,
        branch: task.workspace?.branch,
        gitStatus: task.diff?.status,
        patch: task.diff?.patch
      })),
      gateResults: run.qualityGates.map((gate) => ({
        id: gate.id,
        title: gate.title,
        status: gate.status,
        exitCode: gate.result?.exitCode,
        stdout: gate.result?.stdout,
        stderr: gate.result?.stderr
      }))
    };

    return this.artifactStore?.persistReport(run, report) ?? report;
  }

  private async runTask(
    run: LocalWorkflowRun,
    task: TaskRunRecord,
    cwd?: string,
    signal?: AbortSignal
  ): Promise<ShellRunResult> {
    const cliAgent = this.cliAgents.get(task.agent);

    if (cliAgent) {
      if (!cwd) {
        throw new Error("CLI agent tasks require a workspace path.");
      }

      return cliAgent.run({
        workspace: cwd,
        goal: run.goal,
        instructions: task.instructions ?? task.command ?? "",
        timeoutMs: task.timeoutMs,
        signal
      });
    }

    if (!task.command) {
      throw new Error(`Task ${task.id} requires a command or configured agent.`);
    }

    return this.shell.run({
      command: task.command,
      cwd,
      timeoutMs: task.timeoutMs,
      signal
    });
  }

  private dependenciesPassed(
    run: LocalWorkflowRun,
    dependencyIds: string[]
  ): boolean {
    return dependencyIds.every((dependencyId) => {
      const dependency = run.tasks.find((task) => task.id === dependencyId);
      return dependency?.status === "passed";
    });
  }

  private mustGetWorkflow(id: string): LocalWorkflowRun {
    const run = this.runs.get(id);

    if (!run) {
      throw new Error(`Workflow not found: ${id}`);
    }

    return run;
  }

  private updateStatus(
    run: LocalWorkflowRun,
    status: RunnerWorkflowStatus
  ): void {
    run.status = status;
    run.updatedAt = new Date().toISOString();
    this.persist(run);
  }

  private persist(run: LocalWorkflowRun): void {
    this.runStore?.save(run);
  }

  private emitEvent(event: WorkflowRuntimeEvent): void {
    this.eventSink?.(event);
  }

  private async createTaskWorkspace(
    run: LocalWorkflowRun,
    task: TaskRunRecord
  ): Promise<WorktreeWorkspace> {
    if (!run.repositoryPath) {
      throw new Error("repositoryPath is required for worktree execution.");
    }

    const manager = new GitWorktreeManager({
      repoPath: run.repositoryPath,
      worktreeRoot: run.worktreeRoot,
      shell: this.shell
    });

    return manager.createWorkspace({
      workflowId: run.id,
      taskId: task.id
    });
  }

  private lastTaskWorkspacePath(run: LocalWorkflowRun): string | undefined {
    return [...run.tasks].reverse().find((task) => task.workspace)?.workspace?.path;
  }
}

function resolveTaskCwd(workspacePath: string, cwd?: string): string {
  return cwd ? join(workspacePath, cwd) : workspacePath;
}

function isWorkspaceCleanupAllowed(status: RunnerWorkflowStatus): boolean {
  return ["completed", "aborted", "archived"].includes(status);
}

function workspaceCleanupBlockedReason(status: RunnerWorkflowStatus): string {
  return `Workflow is ${status}; workspaces can only be cleaned after completion or abort.`;
}

function createCanceledResult(command: string): ShellRunResult {
  const now = new Date().toISOString();

  return {
    command,
    status: "canceled",
    exitCode: 1,
    stdout: "",
    stderr: "Command canceled.",
    durationMs: 0,
    startedAt: now,
    finishedAt: now,
    metadata: {
      canceled: "true"
    }
  };
}

function createInterruptedResult(
  command: string,
  reason: "api_restart"
): ShellRunResult {
  const now = new Date().toISOString();

  return {
    command,
    status: "canceled",
    exitCode: 1,
    stdout: "",
    stderr: "Command interrupted by API restart.",
    durationMs: 0,
    startedAt: now,
    finishedAt: now,
    metadata: {
      canceled: "true",
      interrupted: reason
    }
  };
}

export function createDemoWorkflowDefinition(): WorkflowDefinition {
  const node = JSON.stringify(process.execPath);

  return {
    goal: "Run a local multi-step workflow with shell tasks and quality gates.",
    tasks: [
      {
        id: "plan",
        title: "Plan workflow",
        agent: "shell",
        command: `${node} -e "console.log('planner produced task graph')"`
      },
      {
        id: "implement",
        title: "Implement placeholder",
        agent: "shell",
        dependsOn: ["plan"],
        command: `${node} -e "console.log('implementation step completed')"`
      },
      {
        id: "aggregate",
        title: "Aggregate results",
        agent: "shell",
        dependsOn: ["implement"],
        command: `${node} -e "console.log('report artifacts collected')"`
      }
    ],
    qualityGates: [
      {
        id: "node",
        title: "Node runtime",
        command: `${node} --version`
      },
      {
        id: "git",
        title: "Git runtime",
        command: "git --version"
      }
    ]
  };
}
