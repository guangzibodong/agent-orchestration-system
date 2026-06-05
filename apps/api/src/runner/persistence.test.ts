import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileArtifactStore } from "./file-artifact-store.js";
import { FileRunStore } from "./file-run-store.js";
import { LocalRunner } from "./local-runner.js";
import { ShellAdapter } from "./shell-adapter.js";

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
  const repoPath = await mkdtemp(join(tmpdir(), "mawo-persist-repo-test-"));
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

describe("persistent runs", () => {
  it("restores completed workflow state and report artifacts across runner instances", async () => {
    const root = await mkdtemp(join(tmpdir(), "mawo-persist-test-"));
    tempRoots.push(root);
    const stateFile = join(root, "state", "workflows.json");
    const artifactRoot = join(root, "artifacts");
    const repoPath = await createCommittedRepo();
    const runner = new LocalRunner(undefined, {
      runStore: new FileRunStore({ stateFile }),
      artifactStore: new FileArtifactStore({ root: artifactRoot })
    });

    const run = runner.createWorkflow({
      goal: "Persist a worktree run",
      executionMode: "worktree",
      repositoryPath: repoPath,
      worktreeRoot: join(root, "worktrees"),
      tasks: [
        {
          id: "edit-readme",
          title: "Edit README",
          agent: "shell",
          command: `${node} -e "const fs = require('fs'); fs.appendFileSync('README.md', 'persistent patch\\\\n'); console.log('stdout artifact'); console.error('stderr artifact')"`
        }
      ],
      qualityGates: [
        {
          id: "readme",
          title: "README exists",
          command: `${node} -e "const fs = require('fs'); if (!fs.existsSync('README.md')) process.exit(1); console.log('gate artifact')"`
        }
      ]
    });

    await runner.runWorkflow(run.id);
    const report = runner.getReport(run.id);

    expect(report.reportArtifactPath).toContain("report.json");
    expect(report.taskResults[0]?.stdoutArtifactPath).toContain("stdout.txt");
    expect(report.taskResults[0]?.stderrArtifactPath).toContain("stderr.txt");
    expect(report.taskResults[0]?.patchArtifactPath).toContain("patch.diff");
    expect(await readFile(report.taskResults[0]!.patchArtifactPath!, "utf8")).toContain(
      "+persistent patch"
    );
    expect(await readFile(report.reportArtifactPath!, "utf8")).toContain(
      "ready_for_review"
    );

    const restored = new LocalRunner(undefined, {
      runStore: new FileRunStore({ stateFile }),
      artifactStore: new FileArtifactStore({ root: artifactRoot })
    });
    const restoredRun = restored.getWorkflow(run.id);
    const restoredReport = restored.getReport(run.id);

    expect(restoredRun?.status).toBe("needs_review");
    expect(restoredReport.recommendation).toBe("ready_for_review");
    expect(restoredReport.taskResults[0]?.patch).toContain("+persistent patch");
    expect(restoredReport.taskResults[0]?.patchArtifactPath).toContain("patch.diff");
  });
});
