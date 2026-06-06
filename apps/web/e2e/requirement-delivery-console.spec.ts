import { expect, test, type Page } from "@playwright/test";
import type { WorkflowRun } from "@mawo/shared";

const API_ORIGIN = "http://127.0.0.1:4000";
const apiTokenStorageKey = "mawo-api-token";
const apiTokenRoleStorageKey = "mawo-api-token-role";

test.describe("Requirement Delivery Console smoke", () => {
  test("renders empty delivery state from mocked workflows", async ({
    page,
  }) => {
    await mockApi(page, []);

    await page.goto("/");

    const consoleShell = page.locator("main.deliveryShell");
    await expect(
      consoleShell.getByRole("heading", {
        name: "Requirement Delivery Console",
      }),
    ).toBeVisible();
    await expect(consoleShell.getByLabel("Workflow sync")).toContainText(
      "0 workflow runs loaded",
    );
    await expect(consoleShell.getByText("No requirements yet")).toBeVisible();
    await expect(consoleShell.getByText("No decisions waiting")).toBeVisible();
    await expect(
      consoleShell.getByRole("button", { name: "Legacy Run Console" }),
    ).toHaveClass(/secondaryButton/);
  });

  test("renders KPI, queue, and decision items for mixed workflow states", async ({
    page,
  }) => {
    await mockApi(page, mixedWorkflows);

    await page.goto("/");

    const consoleShell = page.locator("main.deliveryShell");
    await expect(consoleShell.getByLabel("Workflow sync")).toContainText(
      "2 workflow runs loaded",
    );

    await expectMetric(page, "Active", "2");
    await expectMetric(page, "Failed Gates", "1");
    await expectMetric(page, "Waiting Review", "1");

    const requirementQueue = page.locator(".requirementQueuePanel");
    await expect(requirementQueue).toContainText("2 active");
    await expect(requirementQueue).toContainText("Update billing copy");
    await expect(requirementQueue).toContainText("Harden auth checks");
    await expect(requirementQueue).toContainText("Retry failed gate");
    await expect(requirementQueue).toContainText("Review merge candidate");

    const decisionQueue = page.locator(".decisionQueuePanel");
    await expect(decisionQueue).toContainText("2 waiting");
    await expect(decisionQueue).toContainText("Blocking");
    await expect(decisionQueue).toContainText("Needs review");
    await expect(decisionQueue).toContainText("Retry failed gate");
    await expect(decisionQueue).toContainText("Review merge candidate");
  });

  test("keeps viewer mode read-only while evidence stays readable", async ({
    page,
  }) => {
    const workflowAuthorizations: Array<string | undefined> = [];

    await page.addInitScript(
      ([tokenKey, roleKey]) => {
        window.localStorage.setItem(tokenKey, "viewer-token");
        window.localStorage.setItem(roleKey, "viewer");
      },
      [apiTokenStorageKey, apiTokenRoleStorageKey],
    );
    await mockApi(page, mixedWorkflows, {
      onWorkflowRequest: (authorization) => {
        workflowAuthorizations.push(authorization);
      },
    });

    await page.goto("/");

    const consoleShell = page.locator("main.deliveryShell");
    await expect(consoleShell.getByLabel("Viewer mode")).toContainText(
      "Write actions are disabled",
    );
    await expect(
      consoleShell.getByRole("button", { name: "New Requirement" }),
    ).toBeDisabled();
    await expect(consoleShell.getByLabel("Repository Safety")).toContainText(
      "Manual git apply only",
    );
    await expect(page.locator(".decisionQueuePanel")).toContainText(
      "Review merge candidate",
    );

    await expect
      .poll(() => workflowAuthorizations.length, {
        message: "wait for workflow requests",
      })
      .toBeGreaterThan(0);
    expect(workflowAuthorizations).toEqual(
      expect.arrayContaining(["Bearer viewer-token"]),
    );
    expect(
      workflowAuthorizations.every(
        (header) => header === "Bearer viewer-token",
      ),
    ).toBe(true);
  });
});

async function expectMetric(page: Page, label: string, value: string) {
  const metric = page
    .getByLabel("Requirement delivery metrics")
    .locator(".deliveryMetric")
    .filter({ hasText: label });

  await expect(metric.locator("strong")).toHaveText(value);
}

async function mockApi(
  page: Page,
  workflows: WorkflowRun[],
  options: {
    onWorkflowRequest?: (authorization: string | undefined) => void;
  } = {},
) {
  await page.route(`${API_ORIGIN}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === "GET" && url.pathname === "/workflows") {
      options.onWorkflowRequest?.(request.headers().authorization);
      await route.fulfill({ json: workflows });
      return;
    }

    const workflow = workflows.find((item) =>
      url.pathname.startsWith(`/workflows/${item.id}`),
    );

    if (
      request.method() === "GET" &&
      workflow &&
      url.pathname.endsWith("/workspaces")
    ) {
      await route.fulfill({
        json: {
          workflowId: workflow.id,
          workflowStatus: workflow.status,
          cleanupAllowed: false,
          blockedReason: "Smoke test keeps workspaces read-only.",
          workspaceCount: 0,
          existingCount: 0,
          workspaces: [],
        },
      });
      return;
    }

    if (
      request.method() === "GET" &&
      workflow &&
      url.pathname === `/workflows/${workflow.id}`
    ) {
      await route.fulfill({ json: workflow });
      return;
    }

    await route.fulfill({
      status: fallbackStatus(request),
      json: fallbackBody(url.pathname),
    });
  });
}

function fallbackStatus(request: { method(): string }) {
  return request.method() === "GET" ? 200 : 403;
}

function fallbackBody(pathname: string) {
  switch (pathname) {
    case "/agents":
    case "/agents/health":
    case "/repositories":
    case "/audit-events":
    case "/jobs":
      return [];
    case "/readiness":
      return readiness;
    case "/workers/health":
      return workerHealth;
    case "/operations/snapshot":
      return operationsSnapshot;
    default:
      return { error: "forbidden", role: "viewer" };
  }
}

const baseWorkflow: WorkflowRun = {
  id: "workflow-base",
  goal: "Base requirement",
  status: "ready",
  executionMode: "worktree",
  repositoryPath: "C:/work/shop",
  createdAt: "2026-06-06T09:00:00.000Z",
  updatedAt: "2026-06-06T09:05:00.000Z",
  tasks: [
    {
      id: "task-1",
      title: "Patch implementation",
      status: "passed",
      workspace: {
        path: "C:/worktrees/shop/task-1",
        branch: "mawo/workflow-base/task-1",
        repoPath: "C:/work/shop",
      },
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

const mixedWorkflows: WorkflowRun[] = [
  {
    ...baseWorkflow,
    id: "workflow-gate-failed",
    goal: "Update billing copy",
    status: "gate_failed",
    updatedAt: "2026-06-06T10:00:00.000Z",
    qualityGates: [
      {
        id: "gate-1",
        title: "Copy checks",
        status: "failed",
      },
    ],
  },
  {
    ...baseWorkflow,
    id: "workflow-needs-review",
    goal: "Harden auth checks",
    status: "needs_review",
    repositoryPath: "C:/work/auth-service",
    updatedAt: "2026-06-06T10:10:00.000Z",
  },
];

const readiness = {
  ok: true,
  service: "mawo-api",
  checkedAt: "2026-06-06T10:20:00.000Z",
  deploymentMode: "development",
  protectedByToken: true,
  root: "C:/work",
  activeJobs: 0,
  checks: [],
};

const workerHealth = {
  ok: true,
  checkedAt: "2026-06-06T10:20:00.000Z",
  staleAfterMs: 30000,
  summary: {
    totalWorkers: 0,
    healthyWorkers: 0,
    staleWorkers: 0,
  },
  workers: [],
};

const operationsSnapshot = {
  checkedAt: "2026-06-06T10:20:00.000Z",
  summary: {
    queuedJobs: 0,
    runningJobs: 0,
    activeJobs: 0,
    failedJobs: 0,
    needsReviewWorkflows: 0,
    blockedReadinessChecks: 0,
    healthyWorkers: 0,
    totalWorkers: 0,
  },
  auditEvents: [],
  jobs: [],
  readiness,
  workerHealth,
};
