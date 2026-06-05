import { readFileSync } from "node:fs";
import { workflowJobSchema, type WorkflowJob } from "@mawo/shared";
import { writeJsonFileAtomically } from "./atomic-json-file.js";

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

    writeJsonFileAtomically(this.stateFile, jobs);
  }
}
