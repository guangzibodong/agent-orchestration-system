import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ShellAdapter } from "./shell-adapter.js";
import type { WorkflowDefinition } from "./local-runner.js";

export function createFakeAgentConfig() {
  return {
    id: "fake-agent",
    label: "Fake CLI Agent",
    commandTemplate: `${JSON.stringify(process.execPath)} {promptFile}`
  };
}

export async function createWorktreeDemoWorkflowDefinition(
  demoRoot = process.cwd(),
  shell = new ShellAdapter()
): Promise<WorkflowDefinition> {
  const repoPath = join(demoRoot, ".mawo", "demo-repo");
  const worktreeRoot = join(demoRoot, ".mawo", "worktrees");
  await ensureCommittedDemoRepository(repoPath, shell);
  const node = JSON.stringify(process.execPath);

  return {
    goal: "Run a task inside an isolated git worktree and capture its patch.",
    executionMode: "worktree",
    repositoryPath: repoPath,
    worktreeRoot,
    tasks: [
      {
        id: "worktree-edit",
        title: "Edit demo repository",
        agent: "shell",
        command: `${node} -e "const fs = require('fs'); fs.appendFileSync('README.md', 'worktree runner\\\\n'); fs.writeFileSync('agent-output.txt', 'artifact from worktree\\\\n')"`
      }
    ],
    qualityGates: [
      {
        id: "artifact",
        title: "Artifact exists",
        command: `${node} -e "const fs = require('fs'); if (!fs.existsSync('agent-output.txt')) process.exit(1); console.log('artifact present')"`
      }
    ]
  };
}

export async function createAgentDemoWorkflowDefinition(
  demoRoot = process.cwd(),
  shell = new ShellAdapter()
): Promise<WorkflowDefinition> {
  const repoPath = join(demoRoot, ".mawo", "agent-demo-repo");
  const worktreeRoot = join(demoRoot, ".mawo", "agent-worktrees");
  await ensureCommittedDemoRepository(repoPath, shell);
  const node = JSON.stringify(process.execPath);

  return {
    goal: "Run a configurable CLI agent inside a git worktree and capture its patch.",
    executionMode: "worktree",
    repositoryPath: repoPath,
    worktreeRoot,
    tasks: [
      {
        id: "cli-agent-edit",
        title: "CLI agent edit",
        agent: "fake-agent",
        instructions:
          "const fs = require('fs'); fs.appendFileSync('README.md', 'cli agent adapter\\\\n'); fs.writeFileSync('agent-output.txt', 'adapter artifact\\\\n'); console.log('fake cli agent completed');"
      }
    ],
    qualityGates: [
      {
        id: "agent-artifact",
        title: "Agent artifact exists",
        command: `${node} -e "const fs = require('fs'); if (!fs.existsSync('agent-output.txt')) process.exit(1); console.log('agent artifact present')"`
      }
    ]
  };
}

async function ensureCommittedDemoRepository(
  repoPath: string,
  shell: ShellAdapter
): Promise<void> {
  await mkdir(repoPath, { recursive: true });

  if (await hasCommittedHead(repoPath, shell)) {
    return;
  }

  await run("git init -b main", repoPath, shell);
  await run('git config user.email "demo@example.com"', repoPath, shell);
  await run('git config user.name "MAWO Demo"', repoPath, shell);
  await writeFile(
    join(repoPath, "README.md"),
    "# MAWO Demo Repository\n\nThis repository is used by the worktree demo.\n",
    "utf8"
  );
  await run("git add README.md", repoPath, shell);
  await run('git commit -m "initial demo repository"', repoPath, shell);
}

async function hasCommittedHead(
  repoPath: string,
  shell: ShellAdapter
): Promise<boolean> {
  const result = await shell.run({
    command: "git rev-parse --verify HEAD",
    cwd: repoPath
  });

  return result.status === "passed";
}

async function run(
  command: string,
  cwd: string,
  shell: ShellAdapter
): Promise<void> {
  const result = await shell.run({ command, cwd });

  if (result.status !== "passed") {
    throw new Error(result.stderr || result.stdout || `Command failed: ${command}`);
  }
}
