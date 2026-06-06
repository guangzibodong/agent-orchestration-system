import { createRepositoryWorkflowRequestSchema } from "@mawo/shared";
import { describe, expect, it } from "vitest";
import { createRepositoryWorkflowDefinition } from "./repository-workflow.js";
import { ShellAdapter, type ShellRunResult } from "./shell-adapter.js";

const passedGitResult: ShellRunResult = {
  command: "git",
  status: "passed",
  exitCode: 0,
  stdout: "ok",
  stderr: "",
  durationMs: 1,
  startedAt: "2026-06-06T00:00:00.000Z",
  finishedAt: "2026-06-06T00:00:00.001Z"
};

describe("createRepositoryWorkflowDefinition", () => {
  it("preserves optional quality gates and defaults unspecified gates to required", async () => {
    const shell = {
      run: async () => passedGitResult
    } as ShellAdapter;

    const request = createRepositoryWorkflowRequestSchema.parse({
      goal: "Run a repository workflow with optional gates",
      repositoryPath: "C:/repo",
      tasks: [
        {
          id: "implement",
          agent: "shell",
          command: "npm test"
        }
      ],
      qualityGates: [
        {
          id: "optional-lint",
          title: "Optional lint",
          command: "npm run lint",
          required: false
        },
        {
          id: "unit",
          title: "Unit tests",
          command: "npm test"
        }
      ]
    });

    const definition = await createRepositoryWorkflowDefinition(
      {
        ...request,
        repositoryPath: request.repositoryPath!
      },
      {
        root: "C:/mawo",
        shell
      }
    );

    expect(definition.qualityGates[0]).toMatchObject({
      id: "optional-lint",
      required: false
    });
    expect(definition.qualityGates[1]).toMatchObject({
      id: "unit",
      required: true
    });
  });
});
