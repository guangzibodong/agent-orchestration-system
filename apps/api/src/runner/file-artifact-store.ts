import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  LocalWorkflowRun,
  MergeCandidate,
  RunReport
} from "./local-runner.js";

export type ArtifactStore = {
  persistReport(run: LocalWorkflowRun, report: RunReport): RunReport;
  persistMergeCandidate(
    run: LocalWorkflowRun,
    candidate: MergeCandidate
  ): MergeCandidate;
};

export type FileArtifactStoreOptions = {
  root: string;
};

export class FileArtifactStore implements ArtifactStore {
  private readonly root: string;

  constructor(options: FileArtifactStoreOptions) {
    this.root = options.root;
  }

  persistReport(run: LocalWorkflowRun, report: RunReport): RunReport {
    const runRoot = join(this.root, run.id);
    mkdirSync(runRoot, { recursive: true });

    const enriched: RunReport = {
      ...report,
      taskResults: report.taskResults.map((task) => {
        const taskRoot = join(runRoot, "tasks", task.id);
        mkdirSync(taskRoot, { recursive: true });

        return {
          ...task,
          stdoutArtifactPath: writeArtifact(taskRoot, "stdout.txt", task.stdout),
          stderrArtifactPath: writeArtifact(taskRoot, "stderr.txt", task.stderr),
          gitStatusArtifactPath: writeArtifact(
            taskRoot,
            "git-status.txt",
            task.gitStatus
          ),
          patchArtifactPath: writeArtifact(taskRoot, "patch.diff", task.patch)
        };
      }),
      gateResults: report.gateResults.map((gate) => {
        const gateRoot = join(runRoot, "gates", gate.id);
        mkdirSync(gateRoot, { recursive: true });

        return {
          ...gate,
          stdoutArtifactPath: writeArtifact(gateRoot, "stdout.txt", gate.stdout),
          stderrArtifactPath: writeArtifact(gateRoot, "stderr.txt", gate.stderr)
        };
      })
    };

    const reportPath = join(runRoot, "report.json");
    enriched.reportArtifactPath = reportPath;
    writeFileSync(reportPath, JSON.stringify(enriched, null, 2), "utf8");

    return enriched;
  }

  persistMergeCandidate(
    run: LocalWorkflowRun,
    candidate: MergeCandidate
  ): MergeCandidate {
    const runRoot = join(this.root, run.id);
    mkdirSync(runRoot, { recursive: true });

    const enriched: MergeCandidate = {
      ...candidate
    };

    if (candidate.patch.length > 0) {
      const patchPath = join(runRoot, "merge-candidate.patch");
      writeFileSync(patchPath, candidate.patch, "utf8");
      enriched.patchArtifactPath = patchPath;

      if (run.repositoryPath) {
        enriched.applyCommand = `git -C ${quote(run.repositoryPath)} apply ${quote(
          patchPath
        )}`;
      }
    }

    const manifestPath = join(runRoot, "merge-candidate.json");
    enriched.manifestArtifactPath = manifestPath;
    writeFileSync(manifestPath, JSON.stringify(enriched, null, 2), "utf8");

    return enriched;
  }
}

function writeArtifact(
  root: string,
  name: string,
  content: string | undefined
): string | undefined {
  if (content === undefined || content.length === 0) {
    return undefined;
  }

  const path = join(root, name);
  writeFileSync(path, content, "utf8");
  return path;
}

function quote(value: string): string {
  return JSON.stringify(value);
}
