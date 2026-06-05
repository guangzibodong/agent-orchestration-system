import { join } from "node:path";
import type {
  CreateRepositoryWorkflowRequest,
  QualityGateInput,
  WorkflowTaskInput
} from "@mawo/shared";
import type { WorkflowDefinition } from "./local-runner.js";
import { ShellAdapter } from "./shell-adapter.js";

export type RepositoryWorkflowOptions = {
  root?: string;
  shell?: ShellAdapter;
};

export class RepositoryNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepositoryNotReadyError";
  }
}

export type ResolvedRepositoryWorkflowRequest = Omit<
  CreateRepositoryWorkflowRequest,
  "repositoryPath" | "tasks" | "qualityGates"
> & {
  repositoryPath: string;
  tasks: WorkflowTaskInput[];
  qualityGates: QualityGateInput[];
};

export async function createRepositoryWorkflowDefinition(
  input: ResolvedRepositoryWorkflowRequest,
  options: RepositoryWorkflowOptions = {}
): Promise<WorkflowDefinition> {
  const shell = options.shell ?? new ShellAdapter();
  await assertRepositoryReady(input.repositoryPath, shell);

  return {
    goal: input.goal,
    executionMode: "worktree",
    repositoryId: input.repositoryId,
    repositoryPath: input.repositoryPath,
    worktreeRoot:
      input.worktreeRoot ??
      join(options.root ?? process.cwd(), ".mawo", "repository-worktrees"),
    tasks: input.tasks.map((task, index) => ({
      id: task.id ?? `task-${index + 1}`,
      title: task.title ?? `Task ${index + 1}`,
      agent: task.agent,
      command: task.command,
      instructions: task.instructions,
      cwd: task.cwd,
      timeoutMs: task.timeoutMs,
      dependsOn: task.dependsOn
    })),
    qualityGates: input.qualityGates.map((gate, index) => ({
      id: gate.id ?? `gate-${index + 1}`,
      title: gate.title ?? `Gate ${index + 1}`,
      command: gate.command,
      timeoutMs: gate.timeoutMs,
      cwd: gate.cwd
    }))
  };
}

async function assertRepositoryReady(
  repositoryPath: string,
  shell: ShellAdapter
): Promise<void> {
  try {
    const gitRoot = await shell.run({
      command: "git rev-parse --show-toplevel",
      cwd: repositoryPath
    });

    if (gitRoot.status !== "passed") {
      throw new RepositoryNotReadyError(
        "Repository path must point to a git repository."
      );
    }

    const head = await shell.run({
      command: "git rev-parse --verify HEAD",
      cwd: repositoryPath
    });

    if (head.status !== "passed") {
      throw new RepositoryNotReadyError(
        "Repository must have a committed HEAD before creating a workflow."
      );
    }
  } catch (error) {
    if (error instanceof RepositoryNotReadyError) {
      throw error;
    }

    throw new RepositoryNotReadyError(
      error instanceof Error ? error.message : "Repository is not ready."
    );
  }
}
