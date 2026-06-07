import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { WorkflowRun } from "@mawo/shared";
import { buildDeliveryConsoleModel } from "./delivery-console-model";
import {
  buildNewRequirementPayload,
  newRequirementDraftFromFormData,
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
      required: true,
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
      objective: "Give operators a structured form for requirement delivery",
      acceptanceCriteria:
        "Form submits title, repository, goal, and task contracts\nViewer mode remains read only",
      agent: "shell",
      command: "npm run build:form",
      instructions: "",
      timeoutMs: "90000",
      dependsOn: "",
    },
    {
      title: "Wire submit callback",
      objective: "Send the structured requirement payload to the client callback",
      acceptanceCriteria:
        "Callback receives task-level acceptance\nDependency links remain intact",
      agent: "codex",
      command: "",
      instructions: "Wire the callback through the client component",
      timeoutMs: "",
      dependsOn: "task-1",
    },
    {
      title: "",
      objective: "",
      acceptanceCriteria: "",
      agent: "shell",
      command: "",
      instructions: "",
      timeoutMs: "",
      dependsOn: "",
    },
  ],
  qualityGates: "delivery vitest\noptional: web visual smoke",
};

describe("RequirementDeliveryConsole", () => {
  it("renders the requirement-first console without making legacy runs primary", () => {
    const html = renderConsoleFor([workflow]);

    expect(html).toContain("Requirement Delivery Console");
    expect(html).toContain("New Requirement");
    expect(html).toContain('type="search"');
    expect(html).toContain('aria-label="Search requirements, repos, reports"');
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
    expect(html).toContain("Secondary ops/debug");
    expect(html).toContain(
      'aria-label="Legacy Run Console secondary ops/debug"',
    );
    expect(html).toContain("href=\"#legacy-run-console\"");
    expect(html).toContain("1 task / 1 gate / 2026-06-06T10:10:00.000Z");
    expect(html).not.toContain("Shell Run");
    expect(html.indexOf("New Requirement")).toBeLessThan(
      html.indexOf("Legacy Run Console"),
    );
  });

  it("keeps empty queue states factual without instructional copy", () => {
    const html = renderConsoleFor([]);

    expect(html).toContain("No requirements yet");
    expect(html).toContain("No decisions waiting");
    expect(html).toContain("Repository safety checks pending");
    expect(html).toContain("No active requirement stage");
    expect(html).not.toContain(
      "Create a requirement to produce an isolated, quality-gated merge candidate",
    );
    expect(html).not.toContain(
      "Create a requirement to run repository safety checks",
    );
    expect(html).not.toContain("Complete requirement");
    expect(html).not.toContain(
      "Requirements that need review, retry, clarification, or safety action will appear here",
    );
  });

  it("does not count archived requirements as active queue items", () => {
    const html = renderToStaticMarkup(
      createElement(RequirementDeliveryConsole, {
        model: buildDeliveryConsoleModel([
          workflow,
          {
            ...workflow,
            id: "workflow-archived",
            goal: "Archived checkout evidence",
            status: "archived",
            updatedAt: "2026-06-06T10:30:00.000Z",
          },
        ]),
      }),
    );

    expect(html).toContain("1 active");
    expect(html).not.toContain("2 active");
    expect(html).toContain("Archived checkout evidence");
    expect(html).toContain("Archived");
  });

  it("focuses the first active requirement when archived items sort first", () => {
    const html = renderToStaticMarkup(
      createElement(RequirementDeliveryConsole, {
        model: buildDeliveryConsoleModel([
          {
            ...workflow,
            id: "workflow-archived",
            goal: "Archived checkout evidence",
            status: "archived",
            updatedAt: "2026-06-06T10:30:00.000Z",
          },
          workflow,
        ]),
      }),
    );
    const focusPanel = extractFocusPanel(html);

    expect(focusPanel).toContain("Harden auth checks");
    expect(focusPanel).toContain("Review merge candidate");
    expect(focusPanel).not.toContain("Archived checkout evidence");
    expect(focusPanel).not.toContain("View archived evidence");
  });

  it("renders compact read-only health indicators in the topbar", () => {
    const html = renderToStaticMarkup(
      createElement(RequirementDeliveryConsole, {
        model: buildDeliveryConsoleModel([workflow]),
        topbarHealthIndicators: [
          {
            id: "api",
            label: "API",
            value: "Ready",
            detail: "API readiness check is passing",
            severity: "healthy",
          },
          {
            id: "launch",
            label: "Launch",
            value: "Development ready",
            detail: "Development readiness has no blockers",
            severity: "healthy",
          },
          {
            id: "worker",
            label: "Worker",
            value: "1/1",
            detail: "1 of 1 workers healthy",
            severity: "healthy",
          },
          {
            id: "queue",
            label: "Queue",
            value: "2",
            detail: "2 jobs waiting for workers",
            severity: "warning",
          },
        ],
      }),
    );

    expect(html).toContain('aria-label="Delivery health"');
    expect(html).toContain("API");
    expect(html).toContain("Ready");
    expect(html).toContain("Launch");
    expect(html).toContain("Development ready");
    expect(html).toContain("Worker");
    expect(html).toContain("1/1");
    expect(html).toContain("Queue");
    expect(html).toContain("2");
    expect(html).not.toContain("Operations snapshot summary");
    expect(html).not.toContain("Worker health panel");
    expect(html.indexOf("Delivery health")).toBeLessThan(
      html.indexOf("New Requirement"),
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
            required: true,
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
    expect(html).toContain("Repository safety blocks execution");
    expect(extractStageStepper(html)).toContain(
      "Preflight blocked: Commit, stash, or discard local changes before running mutating workflows.",
    );
    expect(html).toContain("No MAWO auto-merge; manual git apply outside MAWO");
    expect(html).not.toContain("Apply Candidate");
    const enqueueButtons = html.match(/<button[^>]*>[\s\S]*?Enqueue<\/button>/g) ?? [];
    expect(enqueueButtons.length).toBeGreaterThan(0);
    expect(enqueueButtons.every((button) => button.includes('disabled=""'))).toBe(
      true,
    );
  });

  it("renders unavailable CLI agent preflight as a blocking decision", () => {
    const model = buildDeliveryConsoleModel(
      [],
      new Date("2026-06-06T11:10:00.000Z"),
      [
        {
          id: "requirement-codex",
          title: "Run Codex safely",
          repositoryPath: "C:/work/shop",
          goal: "Show missing Codex before enqueue",
          acceptanceCriteria: ["Missing agent is visible before enqueue"],
          constraints: ["No MAWO auto-merge; manual git apply outside MAWO"],
          nonGoals: ["Automatic PR creation"],
          riskLevel: "high",
          contextPaths: [],
          tasks: [
            {
              id: "patch",
              title: "Patch with Codex",
              agent: "codex",
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
        agentHealth: [
          {
            id: "codex",
            label: "Codex CLI",
            configured: false,
            healthy: false,
            status: "missing_command",
            message:
              "Codex CLI command is not configured. Set MAWO_CODEX_COMMAND_TEMPLATE before enqueue.",
            checkedAt: "2026-06-06T11:00:00.000Z",
          },
        ],
      },
    );
    const html = renderToStaticMarkup(
      createElement(RequirementDeliveryConsole, { model }),
    );

    expect(html).toContain("Configure missing agent");
    expect(html).toContain("Agent Availability");
    expect(html).toContain("Unavailable agents");
    expect(html).toContain("Codex CLI");
    expect(html).toContain("Affected tasks: patch");
    expect(html).toContain("Preflight blocked");
    expect(html).toContain("Agent preflight blocks execution");
    expect(extractStageStepper(html)).toContain(
      "Preflight blocked: Configure missing agent",
    );
    expect(html).toContain("Codex CLI command is not configured");
    const enqueueButtons = html.match(/<button[^>]*>[\s\S]*?Enqueue<\/button>/g) ?? [];
    expect(enqueueButtons.length).toBeGreaterThan(0);
    expect(enqueueButtons.every((button) => button.includes('disabled=""'))).toBe(
      true,
    );
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

  it("renders decision queue actions as read-only in viewer mode", () => {
    const html = renderToStaticMarkup(
      createElement(RequirementDeliveryConsole, {
        model: buildDeliveryConsoleModel([
          workflow,
          {
            ...workflow,
            id: "workflow-gate-failed",
            goal: "Fix failed checkout gate",
            status: "gate_failed",
          },
        ]),
        viewerMode: true,
      }),
    );
    const decisionQueue = extractDecisionQueue(html);

    expect(decisionQueue).toContain("Operator token required");
    expect(decisionQueue).not.toContain("Review merge candidate");
    expect(decisionQueue).not.toContain("Retry failed gate");
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
    expect(html).toContain("Local real repository path or registered repository ID");
    expect(html).toContain(
      "Safety preflight checks branch, HEAD, clean/dirty state, and allowed root before mutating runs",
    );
    expect(html).toContain(
      "No MAWO auto-merge; merge candidate stays manual git apply outside MAWO",
    );
    expect(html).toContain("Goal");
    expect(html).toContain("Acceptance criteria");
    expect(html).toContain("Constraints");
    expect(html).toContain("Non-goals");
    expect(html).toContain("Context paths");
    expect(html).toContain("Risk level");
    expect(html).toContain("Task 1");
    expect(html).toContain("Task 1 objective");
    expect(html).toContain("Task 1 acceptance");
    expect(html).toContain("Task 1 command");
    expect(html).toContain("Task 1 depends on");
    expect(html).toContain("Task 5");
    expect(html).toContain("Quality gates");
    expect(html).toContain("Gate 1 command");
    expect(html).toContain("Gate 1 requirement");
    expect(html).toContain("Gate 1 timeout");
    expect(html).toContain("Gate 2 command");
    expect(html).toContain("Gate 2 requirement");
    expect(html).toContain("Gate 2 timeout");
    expect(html).toContain('value="npm test"');
    expect(html).toContain('value="npm run typecheck"');
    expect(html).not.toContain("delivery vitest");
    expect(html).not.toContain("web typecheck");
    expect(html).toContain("Create requirement draft");
    expect(html).not.toContain("raw JSON");
    expect(html).not.toContain("Use a local path now");
  });

  it("reads structured quality gate timeout fields from New Requirement form data", () => {
    const formData = new FormData();

    formData.set("title", "Gate timeout requirement");
    formData.set("repositoryPath", "C:/work/mawo");
    formData.set("goal", "Capture quality gate timeout contract");
    formData.set("acceptanceCriteria", "Gate timeout is submitted");
    formData.set("riskLevel", "medium");
    formData.append("taskTitle", "Build timeout form");
    formData.append("taskObjective", "Capture timeout fields without raw JSON");
    formData.append("taskAcceptanceCriteria", "Timeouts appear in the payload");
    formData.append("taskAgent", "shell");
    formData.append("taskCommand", "npm test");
    formData.append("taskInstructions", "");
    formData.append("taskTimeoutMs", "");
    formData.append("taskDependsOn", "");
    formData.append("gateCommand", "npm test");
    formData.append("gateRequired", "true");
    formData.append("gateTimeoutMs", "120000");
    formData.append("gateCommand", "npm run smoke:ui");
    formData.append("gateRequired", "false");
    formData.append("gateTimeoutMs", "180000");

    expect(newRequirementDraftFromFormData(formData).qualityGates).toEqual([
      {
        command: "npm test",
        required: true,
        timeoutMs: "120000",
      },
      {
        command: "npm run smoke:ui",
        required: false,
        timeoutMs: "180000",
      },
    ]);
  });

  it("builds quality gate timeout contracts for submit callbacks", () => {
    const result = buildNewRequirementPayload({
      ...validNewRequirementDraft,
      qualityGates: [
        {
          command: "npm test",
          required: true,
          timeoutMs: "120000",
        },
        {
          command: "npm run smoke:ui",
          required: false,
          timeoutMs: "180000",
        },
      ],
    } as unknown as NewRequirementDraft);

    expect(result).toMatchObject({
      ok: true,
      payload: {
        qualityGates: [
          {
            title: "npm test",
            command: "npm test",
            required: true,
            timeoutMs: 120000,
          },
          {
            title: "npm run smoke:ui",
            command: "npm run smoke:ui",
            required: false,
            timeoutMs: 180000,
          },
        ],
      },
    });
  });

  it("rejects invalid quality gate timeout contracts", () => {
    const result = buildNewRequirementPayload({
      ...validNewRequirementDraft,
      qualityGates: [
        {
          command: "npm test",
          required: true,
          timeoutMs: "0",
        },
      ],
    } as unknown as NewRequirementDraft);

    expect(result).toEqual({
      ok: false,
      errors: ["Quality gate timeouts must be positive milliseconds."],
    });
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
            objective:
              "Give operators a structured form for requirement delivery",
            acceptanceCriteria: [
              "Form submits title, repository, goal, and task contracts",
              "Viewer mode remains read only"
            ],
            agent: "shell",
            command: "npm run build:form",
            timeoutMs: 90000,
          },
          {
            id: "task-2",
            title: "Wire submit callback",
            objective:
              "Send the structured requirement payload to the client callback",
            acceptanceCriteria: [
              "Callback receives task-level acceptance",
              "Dependency links remain intact"
            ],
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
            title: "web visual smoke",
            command: "web visual smoke",
            required: false,
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
            objective:
              "Give operators a structured form for requirement delivery",
            acceptanceCriteria: [
              "Form submits title, repository, goal, and task contracts",
              "Viewer mode remains read only"
            ],
            agent: "shell",
            command: "npm run build:form",
            timeoutMs: 90000,
          },
          {
            id: "task-2",
            title: "Wire submit callback",
            objective:
              "Send the structured requirement payload to the client callback",
            acceptanceCriteria: [
              "Callback receives task-level acceptance",
              "Dependency links remain intact"
            ],
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

  it("requires at least one blocking quality gate even when optional gates are present", () => {
    const result = buildNewRequirementPayload({
      ...validNewRequirementDraft,
      qualityGates: "optional: npm run smoke:ui",
    });

    expect(result).toEqual({
      ok: false,
      errors: ["Add at least one required quality gate."],
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
    expect(html).not.toContain("Viewer mode can inspect this flow");
    expect(html).not.toContain("Use a local path now");
    expect(html).not.toContain("Add 1-5 tasks with an execution adapter");
  });
});

function extractFocusPanel(html: string): string {
  const start = html.indexOf('class="deliveryPanel deliveryFocusPanel"');
  const end = html.indexOf('class="deliveryPanel decisionQueuePanel"');

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return html.slice(start, end);
}

function extractDecisionQueue(html: string): string {
  const start = html.indexOf('class="deliveryPanel decisionQueuePanel"');
  const end = html.indexOf("</aside>", start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return html.slice(start, end);
}

function extractStageStepper(html: string): string {
  const start = html.indexOf('aria-label="Stage Stepper"');
  const end = html.indexOf('class="requirementEvidenceCard', start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return html.slice(start, end);
}
