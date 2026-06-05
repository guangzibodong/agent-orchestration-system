import { describe, expect, it } from "vitest";
import {
  buildRepositoryWorkflowPayload,
  canCreateRepositoryWorkflow
} from "./repository-workflow-payload";

describe("repository workflow payload", () => {
  it("builds a repository workflow request from form fields", () => {
    const payload = buildRepositoryWorkflowPayload({
      goal: " Run a real repository ",
      repositoryPath: " C:/repo ",
      agent: "codex",
      taskCommand: " npm test ",
      taskTimeoutMs: "900000",
      qualityGateCommand: " npm run lint ",
      qualityGateTimeoutMs: "300000"
    });

    expect(payload).toMatchObject({
      goal: "Run a real repository",
      repositoryPath: "C:/repo",
      tasks: [
        {
          id: "repository-task",
          title: "Repository task",
          agent: "codex",
          command: "npm test",
          timeoutMs: 900000
        }
      ],
      qualityGates: [
        {
          id: "quality-gate",
          title: "Quality gate",
          command: "npm run lint",
          timeoutMs: 300000
        }
      ]
    });
  });

  it("omits an empty quality gate command", () => {
    const payload = buildRepositoryWorkflowPayload({
      goal: "Run a real repository",
      repositoryPath: "C:/repo",
      agent: "shell",
      taskCommand: "git status --short",
      taskTimeoutMs: "",
      qualityGateCommand: " ",
      qualityGateTimeoutMs: ""
    });

    expect(payload.qualityGates).toEqual([]);
  });

  it("detects when required repository fields are missing", () => {
    expect(
      canCreateRepositoryWorkflow({
        goal: "Run",
        repositoryPath: "",
        agent: "shell",
        taskCommand: "npm test",
        taskTimeoutMs: "",
        qualityGateCommand: "",
        qualityGateTimeoutMs: ""
      })
    ).toBe(false);
  });
});
