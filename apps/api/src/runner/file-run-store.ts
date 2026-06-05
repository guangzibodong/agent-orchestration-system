import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { LocalWorkflowRun } from "./local-runner.js";

export type RunStore = {
  list(): LocalWorkflowRun[];
  save(run: LocalWorkflowRun): void;
};

export type FileRunStoreOptions = {
  stateFile: string;
};

export class FileRunStore implements RunStore {
  private readonly stateFile: string;

  constructor(options: FileRunStoreOptions) {
    this.stateFile = options.stateFile;
  }

  list(): LocalWorkflowRun[] {
    try {
      return JSON.parse(readFileSync(this.stateFile, "utf8")) as LocalWorkflowRun[];
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return [];
      }

      throw error;
    }
  }

  save(run: LocalWorkflowRun): void {
    const runs = this.list();
    const index = runs.findIndex((existing) => existing.id === run.id);

    if (index >= 0) {
      runs[index] = run;
    } else {
      runs.push(run);
    }

    mkdirSync(dirname(this.stateFile), { recursive: true });
    const tempFile = `${this.stateFile}.tmp`;
    writeFileSync(tempFile, JSON.stringify(runs, null, 2), "utf8");
    renameSync(tempFile, this.stateFile);
  }
}
