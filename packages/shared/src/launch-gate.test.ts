import { describe, expect, it } from "vitest";
import {
  buildLaunchGateEvidence,
  buildLaunchGatePlan,
  renderLaunchGateMarkdown,
  shouldUseShellForLaunchGateCommand,
} from "./launch-gate";

describe("launch gate planning", () => {
  it("plans the frozen local release checks before external Postgres checks", () => {
    const plan = buildLaunchGatePlan({
      env: {},
      npmCommand: "npm.cmd",
    });

    expect(
      plan
        .filter((check) => check.execution === "run")
        .map((check) => check.id),
    ).toEqual([
      "env",
      "git_diff_check",
      "typecheck",
      "lint",
      "test",
      "build",
      "smoke_ui",
      "smoke_api",
      "smoke_api_requirements",
      "smoke_backup_restore",
    ]);

    expect(plan.find((check) => check.id === "smoke_api_postgres")).toMatchObject({
      execution: "external-blocked",
      required: false,
      blockedReason: expect.stringContaining("DATABASE_URL"),
    });
  });

  it("includes Postgres launch checks when DATABASE_URL is available", () => {
    const plan = buildLaunchGatePlan({
      env: {
        DATABASE_URL: "postgresql://mawo:mawo@localhost:5432/mawo",
      },
      npmCommand: "npm.cmd",
      postgresMode: "required",
    });

    expect(
      plan
        .filter((check) => check.execution === "run")
        .map((check) => check.id),
    ).toContain("smoke_api_postgres");
    expect(plan.find((check) => check.id === "smoke_api_postgres")).toMatchObject({
      command: "npm.cmd",
      args: ["run", "smoke:api:postgres"],
    });
  });
});

describe("launch gate evidence", () => {
  it("summarizes branch, commit, dirty files, failures, and blockers", () => {
    const evidence = buildLaunchGateEvidence({
      generatedAt: "2026-06-06T16:20:35.069Z",
      root: "C:/repo",
      branch: "main",
      commit: "abc1234",
      dirtyFiles: ["M package.json"],
      checks: [
        {
          id: "typecheck",
          label: "Typecheck",
          required: true,
          command: "npm.cmd",
          args: ["run", "typecheck"],
          status: "passed",
          exitCode: 0,
          durationMs: 1200,
          stdoutSummary: "ok",
          stderrSummary: "",
        },
        {
          id: "lint",
          label: "Lint",
          required: true,
          command: "npm.cmd",
          args: ["run", "lint"],
          status: "failed",
          exitCode: 1,
          durationMs: 900,
          stdoutSummary: "",
          stderrSummary: "no-unused-vars",
        },
        {
          id: "smoke_api_postgres",
          label: "Postgres API smoke",
          required: false,
          command: "npm.cmd",
          args: ["run", "smoke:api:postgres"],
          status: "external-blocked",
          blockedReason: "DATABASE_URL is not configured.",
        },
      ],
    });

    expect(evidence.localDecision).toBe("failed");
    expect(evidence.productionDecision).toBe("blocked");
    expect(evidence.failureSummaries).toEqual([
      "lint failed with exit code 1: no-unused-vars",
    ]);
    expect(evidence.externalBlockers).toEqual([
      "smoke_api_postgres: DATABASE_URL is not configured.",
    ]);
  });

  it("renders markdown evidence with frozen references and command outcomes", () => {
    const evidence = buildLaunchGateEvidence({
      generatedAt: "2026-06-06T16:20:35.069Z",
      root: "C:/repo",
      branch: "main",
      commit: "abc1234",
      dirtyFiles: [],
      checks: [
        {
          id: "test",
          label: "Test",
          required: true,
          command: "npm.cmd",
          args: ["run", "test"],
          status: "passed",
          exitCode: 0,
          durationMs: 4000,
          stdoutSummary: "323 passed",
          stderrSummary: "",
        },
      ],
    });

    expect(renderLaunchGateMarkdown(evidence)).toContain(
      "docs/product/REQUIREMENTS_FREEZE.md",
    );
    expect(renderLaunchGateMarkdown(evidence)).toContain(
      "| Test | passed | 0 | 4000 | npm.cmd run test |",
    );
  });
});

describe("launch gate process options", () => {
  it("uses a shell for Windows command shims", () => {
    expect(shouldUseShellForLaunchGateCommand("npm.cmd", "win32")).toBe(true);
    expect(shouldUseShellForLaunchGateCommand("tool.bat", "win32")).toBe(true);
    expect(shouldUseShellForLaunchGateCommand("git", "win32")).toBe(false);
    expect(shouldUseShellForLaunchGateCommand("npm", "linux")).toBe(false);
  });
});
