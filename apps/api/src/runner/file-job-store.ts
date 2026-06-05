import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { workflowJobSchema, type WorkflowJob } from "@mawo/shared";

export type JobStore = {
  list(): WorkflowJob[];
  save(job: WorkflowJob): void;
};

export type FileJobStoreOptions = {
  stateFile: string;
};

export class FileJobStore implements JobStore {
  private readonly stateFile: string;

  constructor(options: FileJobStoreOptions) {
    this.stateFile = options.stateFile;
  }

  list(): WorkflowJob[] {
    try {
      const parsed = JSON.parse(readFileSync(this.stateFile, "utf8")) as unknown[];
      return parsed.map((job) => workflowJobSchema.parse(job));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return [];
      }

      throw error;
    }
  }

  save(job: WorkflowJob): void {
    const jobs = this.list();
    const index = jobs.findIndex((existing) => existing.id === job.id);

    if (index >= 0) {
      jobs[index] = job;
    } else {
      jobs.push(job);
    }

    mkdirSync(dirname(this.stateFile), { recursive: true });
    const tempFile = `${this.stateFile}.tmp`;
    writeFileSync(tempFile, JSON.stringify(jobs, null, 2), "utf8");
    renameSync(tempFile, this.stateFile);
  }
}
