import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { WorkflowRun } from "@mawo/shared";
import { buildDeliveryConsoleModel } from "./delivery-console-model";
import {
  buildNewRequirementPayload,
  submitNewRequirementDraft,
  type NewRequirementDraft,
} from "./new-requirement-payload";
import { RequirementDeliveryConsole } from "./requirement-delivery-console";

const workflow: WorkflowRun = {
  id: "workflow-review",
  goal: "Harden auth checks",
  status: "needs_review",
  repositoryPath: "C:/work/api",
  updatedAt: "2026-06-06T10:10:00.000Z",
  tasks: [
    {
      id: "task-1",
      title: "Update auth guard",
      status: "passed",
    },
  ],
  qualityGates: [
    {
      id: "gate-1",
      title: "Unit tests",
      status: "passed",
    },
  ],
};

function renderConsoleFor(workflows: WorkflowRun[]): string {
  return renderToStaticMarkup(
    createElement(RequirementDeliveryConsole, {
      model: buildDeliveryConsoleModel(workflows),
    }),
  );
}

function expectDisabledNamedControl(html: string, name: string) {
  expect(html).toMatch(
    new RegExp(
      `(?:name="${name}"[^>]*disabled=""|disabled=""[^>]*name="${name}")`,
    ),
  );
}

const validNewRequirementDraft: NewRequirementDraft = {
  title: "Ship review evidence panel",
  repositoryPath: "C:/work/mawo",
  repositoryId: "",
  goal: "Create a reviewable delivery ticket without binding to the API",
  acceptanceCriteria:
    "- captures structured payload\n- keeps viewer mode read only",
  constraints: "frontend components only",
  nonGoals: "server API changes",
  contextPaths:
    "apps/web/src/components/delivery\napps/web/src/app/globals.css",
  riskLevel: "high",
  tasks: [
    {
      title: "Build form",
      agent: "shell",
      command: "npm run build:form",
      instructions: "",
      timeoutMs: "90000",
      dependsOn: "",
    },
    {
      title: "Wire submit callback",
      agent: "codex",
      command: "",
      instructions: "Wire the callback through the client component",
      timeoutMs: "",
      dependsOn: "task-1",
    },
    {
      title: "",
      agent: "shell",
      command: "",
      instructions: "",
      timeoutMs: "",
      dependsOn: "",
    },
  ],
  qualityGates: "delivery vitest\nweb typecheck",
};

describe("RequirementDeliveryConsole", () => {
  it("renders the requirement-first console without making legacy runs primary", () => {
    const html = renderConsoleFor([workflow]);

    expect(html).toContain("Requirement Delivery Console");
    expect(html).toContain("New Requirement");
    expect(html).toContain("Requirement Queue");
    expect(html).toContain("Repository Safety");
    expect(html).toContain("C:/work/api");
    expect(html).toContain("Apply clean check required");
    expect(html).toContain("Allowed root accepted by API");
    expect(html).toContain("No MAWO auto-merge; manual git apply outside MAWO");
    expect(html).not.toContain("Branch, HEAD, clean/dirty state");
    expect(html).toContain("Stage Stepper");
    expect(html).toContain("Decision Queue");
    expect(html).toContain("Review merge candidate");
    expect(html).toContain("Legacy Run Console");
    expect(html).toContain("href=\"#legacy-run-console\"");
    expect(html).toContain("1 task / 1 gate / 2026-06-06T10:10:00.000Z");
    expect(html).not.toContain("Shell Run");
    expect(html.indexOf("New Requirement")).toBeLessThan(
      html.indexOf("Legacy Run Console"),
    );
  });

  it("shows required gate failure evidence without raw logs", () => {
    const html = renderConsoleFor([
      {
        ...workflow,
        id: "workflow-gate-failed",
        goal: "Update billing copy",
        status: "gate_failed",
        qualityGates: [
          {
            id: "gate-1",
            title: "Required unit tests",
            status: "failed",
            result: {
              exitCode: 1,
              stdout: '{"internal":"raw-gate-log"}',
              stderr: "stacktrace: private failure details",
            },
          },
        ],
      },
    ]);

    expect(html).toContain("Gate Result / Review Evidence");
    expect(html).toContain("Required gate failed");
    expect(html).toContain("Merge approval blocked");
    expect(html).toContain("Retry failed gate");
    expect(html).not.toContain("raw-gate-log");
    expect(html).not.toContain("stacktrace");
  });

  it("shows review merge candidate evidence for review-ready requirements", () => {
    const html = renderConsoleFor([workflow]);

    expect(html).toContain("Review merge candidate evidence");
    expect(html).toContain("Quality gates passed");
    expect(html).toContain("Manual review required");
    expect(html).not.toContain("Apply Candidate");
  });

  it("renders blocked repository safety evidence with recovery action", () => {
    const model = buildDeliveryConsoleModel(
      [],
      new Date("2026-06-06T11:10:00.000Z"),
      [
        {
          id: "requirement-dirty",
          title: "Run dirty repo safely",
          repositoryId: "repo-dirty",
          repositoryPath: "C:/work/shop",
          goal: "Block execution until repository safety is clear",
          acceptanceCriteria: ["Dirty repository state is visible"],
          constraints: ["No MAWO auto-merge; manual git apply outside MAWO"],
          nonGoals: ["Automatic PR creation"],
          riskLevel: "high",
          contextPaths: [],
          tasks: [
            {
              id: "task-1",
              title: "Patch checkout",
              agent: "shell",
              instructions: "Patch checkout",
            },
          ],
          qualityGates: [
            {
              id: "gate-1",
              title: "Unit tests",
              command: "npm test",
              required: true,
            },
          ],
          status: "ready_to_run",
          runLinks: [],
          createdAt: "2026-06-06T11:00:00.000Z",
          updatedAt: "2026-06-06T11:05:00.000Z",
        },
      ],
      {
        repositorySafetyByRepositoryId: {
          "repo-dirty": {
            repositoryId: "repo-dirty",
            path: "C:/work/shop",
            defaultBranch: "main",
            currentBranch: "feature/checkout",
            headShortSha: "abc1234",
            clean: false,
            dirty: true,
            allowedRoot: true,
            blockedReason: "repository_dirty",
            recoveryAction:
              "Commit, stash, or discard local changes before running mutating workflows.",
            noAutoMerge: true,
            manualApplyPolicy:
              "Manual review is required; MAWO never automatically merges repository changes.",
          },
        },
      },
    );
    const html = renderToStaticMarkup(
      createElement(RequirementDeliveryConsole, { model }),
    );

    expect(html).toContain("Safety blocked");
    expect(html).toContain("Dirty - mutating runs blocked");
    expect(html).toContain("Allowed root accepted by API");
    expect(html).toContain("HEAD abc1234");
    expect(html).toContain(
      "Repository has uncommitted changes; mutating requirement runs are blocked.",
    );
    expect(html).toContain(
      "Commit, stash, or discard local changes before running mutating workflows.",
    );
    expect(html).toContain("No MAWO auto-merge; manual git apply outside MAWO");
    expect(html).not.toContain("Apply Candidate");
  });

  it("renders review evidence artifacts inside the requirement detail shell", () => {
    const html = renderConsoleFor([workflow]);

    expect(html).toContain("Evidence links");
    expect(html).toContain("Artifacts");
    expect(html).toContain("Merge candidate evidence");
    expect(html).not.toContain("No artifacts linked yet");
  });

  it("shows delivered evidence for approved completed requirements", () => {
    const html = renderConsoleFor([
      {
        ...workflow,
        id: "workflow-approved",
        status: "completed",
        review: {
          decision: "approved",
          note: "Looks ready",
          reviewedAt: "2026-06-06T10:30:00.000Z",
        },
      },
    ]);

    expect(html).toContain("Delivered evidence");
    expect(html).toContain("Approved delivery");
    expect(html).toContain("Review delivered evidence");
  });

  it("keeps write actions disabled in viewer mode", () => {
    const html = renderToStaticMarkup(
      createElement(RequirementDeliveryConsole, {
        model: buildDeliveryConsoleModel([workflow]),
        viewerMode: true,
      }),
    );

    expect(html).toContain("Viewer mode");
    expect(html).toContain("Write actions are disabled");
    expect(html).toContain("disabled");
  });

  it("renders a New Requirement panel with the frozen ticket fields", () => {
    const html = renderToStaticMarkup(
      createElement(RequirementDeliveryConsole, {
        model: buildDeliveryConsoleModel([workflow]),
        initialNewRequirementPanelOpen: true,
      }),
    );

    expect(html).toContain("New Requirement panel");
    expect(html).toContain("Title");
    expect(html).toContain("Repository path");
    expect(html).toContain("Repository ID");
    expect(html).toContain("Repository path or registered ID");
    expect(html).toContain("Goal");
    expect(html).toContain("Acceptance criteria");
    expect(html).toContain("Constraints");
    expect(html).toContain("Non-goals");
    expect(html).toContain("Context paths");
    expect(html).toContain("Risk level");
    expect(html).toContain("Task 1");
    expect(html).toContain("Task 1 command");
    expect(html).toContain("Task 1 depends on");
    expect(html).toContain("Task 5");
    expect(html).toContain("Quality gates");
    expect(html).toContain("Create requirement draft");
    expect(html).not.toContain("raw JSON");
  });

  it("builds a structured New Requirement payload for submit callbacks", () => {
    const result = buildNewRequirementPayload(validNewRequirementDraft);

    expect(result).toEqual({
      ok: true,
      payload: {
        title: "Ship review evidence panel",
        repositoryPath: "C:/work/mawo",
        goal: "Create a reviewable delivery ticket without binding to the API",
        acceptanceCriteria: [
          "captures structured payload",
          "keeps viewer mode read only",
        ],
        constraints: ["frontend components only"],
        nonGoals: ["server API changes"],
        contextPaths: [
          "apps/web/src/components/delivery",
          "apps/web/src/app/globals.css",
        ],
        riskLevel: "high",
        tasks: [
          {
            id: "task-1",
            title: "Build form",
            agent: "shell",
            command: "npm run build:form",
            timeoutMs: 90000,
          },
          {
            id: "task-2",
            title: "Wire submit callback",
            agent: "codex",
            instructions: "Wire the callback through the client component",
            dependsOn: ["task-1"],
          },
        ],
        qualityGates: [
          {
            title: "delivery vitest",
            command: "delivery vitest",
            required: true,
          },
          {
            title: "web typecheck",
            command: "web typecheck",
            required: true,
          },
        ],
      },
    });
  });

  it("submits the structured payload through a callback", () => {
    const submitted = new Array<unknown>();
    const result = submitNewRequirementDraft(validNewRequirementDraft, (payload) =>
      submitted.push(payload),
    );

    expect(result.ok).toBe(true);
    expect(submitted).toEqual([
      expect.objectContaining({
        title: "Ship review evidence panel",
        repositoryPath: "C:/work/mawo",
        tasks: [
          {
            id: "task-1",
            title: "Build form",
            agent: "shell",
            command: "npm run build:form",
            timeoutMs: 90000,
          },
          {
            id: "task-2",
            title: "Wire submit callback",
            agent: "codex",
            instructions: "Wire the callback through the client component",
            dependsOn: ["task-1"],
          },
        ],
      }),
    ]);
  });

  it("rejects New Requirement payloads without 1-5 tasks or quality gates", () => {
    const result = buildNewRequirementPayload({
      ...validNewRequirementDraft,
      tasks: [],
      qualityGates: "",
    });

    expect(result).toEqual({
      ok: false,
      errors: ["Add 1-5 tasks.", "Add at least one required quality gate."],
    });
  });

  it("keeps the New Requirement form read-only in viewer mode", () => {
    const html = renderToStaticMarkup(
      createElement(RequirementDeliveryConsole, {
        model: buildDeliveryConsoleModel([workflow]),
        initialNewRequirementPanelOpen: true,
        viewerMode: true,
      }),
    );

    expect(html).toContain("Viewer mode");
    expectDisabledNamedControl(html, "title");
    expectDisabledNamedControl(html, "goal");
    expect(html).toContain('type="submit" disabled=""');
  });
});
