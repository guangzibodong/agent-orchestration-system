import { expect, test, type Locator, type Page } from "@playwright/test";
import type { RequirementDeliveryTicket, WorkflowRun } from "@mawo/shared";

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
      "0 requirement tickets loaded",
    );
    await expect(consoleShell.getByText("No requirements yet")).toBeVisible();
    await expect(consoleShell.getByText("No decisions waiting")).toBeVisible();
    await expect(
      consoleShell.getByRole("link", { name: "Legacy Run Console" }),
    ).toHaveClass(/secondaryButton/);
    await expect(
      consoleShell.getByRole("link", { name: "Legacy Run Console" }),
    ).toHaveAttribute("href", /#legacy-run-console$/);
  });

  test("renders KPI, queue, and decision items for mixed workflow states", async ({
    page,
  }) => {
    await mockApi(page, mixedWorkflows);

    await page.goto("/");

    const consoleShell = page.locator("main.deliveryShell");
    await expect(consoleShell.getByLabel("Workflow sync")).toContainText(
      "2 requirement tickets loaded",
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
    const mutatingRequests: string[] = [];
    const workflowAuthorizations: Array<string | undefined> = [];

    await page.addInitScript(
      ([tokenKey, roleKey]) => {
        window.localStorage.setItem(tokenKey, "viewer-token");
        window.localStorage.setItem(roleKey, "viewer");
      },
      [apiTokenStorageKey, apiTokenRoleStorageKey],
    );
    await mockApi(page, mixedWorkflows, {
      requirements: requirementTickets,
      onMutatingRequest: ({ method, pathname }) => {
        mutatingRequests.push(`${method} ${pathname}`);
      },
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
      "No MAWO auto-merge; manual git apply outside MAWO",
    );
    await expect(page.locator(".decisionQueuePanel")).toContainText(
      "Review merge candidate",
    );

    await page.locator(".requirementDetailDisclosure > summary").click();
    const detail = page.locator(".requirementDetailShell");
    const lifecycleActions = detail.getByLabel("Requirement lifecycle actions");
    const reviewActions = detail.getByLabel("Review actions");
    await expect(
      lifecycleActions.getByRole("button", { name: "Confirm plan" }),
    ).toBeDisabled();
    await expect(
      lifecycleActions.getByRole("button", { name: "Enqueue" }),
    ).toBeDisabled();
    await expect(
      lifecycleActions.getByRole("button", { name: "Retry" }),
    ).toBeDisabled();
    await expect(
      reviewActions.getByRole("button", { name: "Approve" }),
    ).toBeDisabled();
    await expect(
      reviewActions.getByRole("button", { name: "Reject" }),
    ).toBeDisabled();
    await expect(
      reviewActions.getByRole("button", { name: "Retry" }),
    ).toBeDisabled();

    await page.locator("#legacy-run-console > summary").click();
    const legacyConsole = page.locator("#legacy-run-console");
    await expect(
      legacyConsole.getByRole("button", { name: "Shell Run" }),
    ).toBeDisabled();
    await expect(
      legacyConsole.getByRole("button", { name: "Worktree Run" }),
    ).toBeDisabled();
    await expect(
      legacyConsole.getByRole("button", { name: "Agent Run" }),
    ).toBeDisabled();
    await expect(
      legacyConsole.getByRole("button", { name: "Run Workflow" }),
    ).toBeDisabled();
    await expect(
      legacyConsole.getByRole("button", { name: "Retry" }),
    ).toBeDisabled();
    await expect(
      legacyConsole.getByRole("button", { name: "Repository Run" }),
    ).toBeDisabled();
    await expect(
      legacyConsole.getByRole("button", { name: "Register Repository" }),
    ).toBeDisabled();
    expect(mutatingRequests).toEqual([]);

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

    const viewerBoundary = await page.evaluate(async (origin) => {
      const headers = {
        Authorization: "Bearer viewer-token",
        "Content-Type": "application/json",
      };
      const readResponse = await fetch(`${origin}/requirements`, { headers });
      const writeResponse = await fetch(`${origin}/requirements`, {
        method: "POST",
        headers,
        body: JSON.stringify({ title: "Viewer write attempt" }),
      });

      return {
        readStatus: readResponse.status,
        readBody: await readResponse.json(),
        writeStatus: writeResponse.status,
        writeBody: await writeResponse.json(),
      };
    }, API_ORIGIN);

    expect(viewerBoundary.readStatus).toBe(200);
    expect(viewerBoundary.readBody).toEqual(requirementTickets);
    expect(viewerBoundary.writeStatus).toBe(403);
    expect(viewerBoundary.writeBody).toMatchObject({
      error: "forbidden",
      role: "viewer",
    });
  });

  test("surfaces report artifact paths for requirement ticket evidence", async ({
    page,
  }) => {
    await mockApi(page, mixedWorkflows, {
      reports: {
        "requirement-viewer-readable": requirementEvidenceReport,
      },
      requirements: requirementTickets,
    });

    await page.goto("/");

    const evidence = page.getByLabel("Gate Result / Review Evidence");
    const evidenceDrawer = evidence.getByLabel("Read-only evidence links");
    await evidenceDrawer.getByText("Evidence links", { exact: true }).click();

    await expect(
      evidenceDrawer.getByRole("link", { name: "Inspect evidence stdout" }),
    ).toHaveAttribute(
      "href",
      "/workflows/workflow-needs-review/artifact?path=C%3A%2Fmawo%2Fartifacts%2Fworkflow-needs-review%2Ftasks%2Ftask-view%2Fstdout.txt",
    );
    await expect(
      evidenceDrawer.getByRole("link", { name: "Inspect evidence stderr" }),
    ).toBeVisible();
    await expect(
      evidenceDrawer.getByRole("link", { name: "Inspect evidence patch" }),
    ).toBeVisible();
    await expect(
      evidenceDrawer.getByRole("link", { name: "Evidence visible stdout" }),
    ).toBeVisible();

    await page.locator(".requirementDetailDisclosure > summary").click();
    const detail = page.getByLabel("Requirement detail sections");
    await expect(detail).toBeVisible();
    const detailDrawer = page.locator(".requirementDetailShell .artifactDrawer");
    await detailDrawer.getByText("Artifacts", { exact: true }).click();
    await expect(
      detailDrawer.getByRole("link", { name: "Inspect evidence stdout" }),
    ).toBeVisible();
    await expect(
      detailDrawer.getByRole("link", { name: "Report artifact" }),
    ).toBeVisible();
  });

  test("keeps gate failed and review evidence visible", async ({ page }) => {
    const mutatingRequests: string[] = [];

    await mockApi(page, mixedWorkflows, {
      onMutatingRequest: ({ method, pathname }) => {
        mutatingRequests.push(`${method} ${pathname}`);
      },
    });

    await page.goto("/");

    const evidence = page.getByLabel("Gate Result / Review Evidence");
    await expect(evidence).toContainText("Gate blocked");
    await expect(evidence).toContainText("Required gate failed");
    await expect(evidence).toContainText("Merge approval blocked");
    await expect(evidence).toContainText(
      "Merge candidate blocked until required gates pass",
    );
    await expect(evidence).toContainText("Retry failed gate");
    await expect(evidence).toContainText(
      "Required gate failed; merge approval is blocked while evidence remains inspectable.",
    );

    await page.locator(".requirementDetailDisclosure > summary").click();
    const detail = page.locator(".requirementDetailShell");
    await expect(detail.getByRole("button", { name: "Approve" })).toBeDisabled();
    await expect(detail.getByRole("button", { name: "Reject" })).toBeDisabled();
    expect(mutatingRequests).toEqual([]);

    await mockApi(page, [
      mixedWorkflows[1] as WorkflowRun,
      mixedWorkflows[0] as WorkflowRun,
    ]);
    await page.reload();

    const reviewEvidence = page.getByLabel("Gate Result / Review Evidence");
    await expect(reviewEvidence).toContainText(
      "Review-ready merge candidate",
    );
    await expect(reviewEvidence).toContainText("Review ready");
    await expect(reviewEvidence).toContainText("Quality gates passed");
    await expect(reviewEvidence).toContainText(
      "No MAWO auto-merge; manual git apply outside MAWO",
    );

    const evidenceDrawer = reviewEvidence.getByLabel("Read-only evidence links");
    await expect(
      evidenceDrawer.getByText("Evidence links", { exact: true }),
    ).toBeVisible();
    await expect(evidenceDrawer.getByText("3 links")).toBeVisible();
    await evidenceDrawer.getByText("Evidence links", { exact: true }).click();
    await expect(
      evidenceDrawer.getByRole("link", { name: "Current workflow" }),
    ).toHaveAttribute("href", "/workflows/workflow-needs-review");
    await expect(
      evidenceDrawer.getByRole("link", { name: "Workflow report" }),
    ).toHaveAttribute("href", "/workflows/workflow-needs-review/report");
    await expect(
      evidenceDrawer.getByRole("link", { name: "Merge candidate evidence" }),
    ).toHaveAttribute(
      "href",
      "/workflows/workflow-needs-review/merge-candidate",
    );
    await expect(
      reviewEvidence.getByRole("button", { name: /apply candidate/i }),
    ).toHaveCount(0);
  });

  test("keeps key requirement labels inside the mobile viewport", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await mockApi(page, mobileStressWorkflows);

    await page.goto("/");

    await expectNoHorizontalDocumentOverflow(page);
    await expectLabelsInsideViewport(page, [
      "Requirement Delivery Console",
      "New Requirement",
      "Legacy Run Console",
      "Repository Safety",
      "Requirement Queue",
      "Decision Queue",
      "Gate Result / Review Evidence",
      "Needs Clarification",
      "Failed Gates",
      "Waiting Review",
      "Retry failed gate",
      "Review merge candidate",
    ]);

    const mobileEvidenceDrawer = page.getByLabel("Read-only evidence links");
    await expect(mobileEvidenceDrawer.getByText("2 links")).toBeVisible();
    await mobileEvidenceDrawer
      .getByText("Evidence links", { exact: true })
      .click();
    await expect(
      mobileEvidenceDrawer.getByRole("link", { name: "Current workflow" }),
    ).toBeVisible();
    await expect(
      mobileEvidenceDrawer.getByRole("link", { name: "Workflow report" }),
    ).toBeVisible();
    await expectNoHorizontalDocumentOverflow(page);
    await expectLabelsInsideViewport(page, [
      "Evidence links",
      "Current workflow",
      "Workflow report",
    ]);
  });

  test("New Requirement flow creates a structured requirement request when available", async ({
    page,
  }) => {
    const createdRequests: unknown[] = [];

    await page.addInitScript(
      ([tokenKey, roleKey]) => {
        window.localStorage.setItem(tokenKey, "operator-token");
        window.localStorage.setItem(roleKey, "operator");
      },
      [apiTokenStorageKey, apiTokenRoleStorageKey],
    );
    await mockApi(page, [], {
      onRequirementCreate: (payload) => {
        createdRequests.push(payload);
      },
    });

    await page.goto("/");

    const newRequirementButton = page.getByRole("button", {
      name: "New Requirement",
    });
    await expect(newRequirementButton).toBeEnabled();
    await newRequirementButton.click();

    const flow = page.getByRole("region", {
      name: "New Requirement panel",
    });
    await expect(flow).toBeVisible();

    await fillField(flow, /title|requirement title/i, "Smoke gated checkout");
    await fillField(flow, /repository path|repository/i, "C:/work/shop");
    await fillField(
      flow,
      /goal/i,
      "Produce an isolated checkout patch with review evidence.",
    );
    await fillField(
      flow,
      /acceptance criteria/i,
      "Patch is isolated; required gates pass; merge candidate stays manual.",
    );
    await fillField(flow, /constraints/i, "No automatic merge.");
    await fillField(flow, /non-?goals/i, "No PR creation.");
    await fillField(flow, /task/i, "Create the checkout copy patch.");
    await fillField(flow, /quality gate|gate/i, "npm test");
    await chooseRisk(flow, "medium");

    await flow
      .getByRole("button", {
        name: /create requirement|save requirement|create/i,
      })
      .click();

    await expect
      .poll(() => createdRequests.length, {
        message: "wait for structured requirement create request",
      })
      .toBe(1);
    expect(createdRequests[0]).toMatchObject({
      title: "Smoke gated checkout",
      repositoryPath: "C:/work/shop",
      goal: "Produce an isolated checkout patch with review evidence.",
      riskLevel: "medium",
    });
    expect(createdRequests[0]).toMatchObject({
      acceptanceCriteria: expect.any(Array),
      constraints: expect.any(Array),
      nonGoals: expect.any(Array),
      tasks: expect.arrayContaining([
        expect.objectContaining({
          title: expect.stringMatching(/checkout copy patch/i),
        }),
      ]),
      qualityGates: expect.arrayContaining([
        expect.objectContaining({
          command: "npm test",
          required: true,
        }),
      ]),
    });
  });

  test("operator can confirm, enqueue, and retry requirement lifecycle actions", async ({
    page,
  }) => {
    const actions: string[] = [];
    const lifecycleWorkflows: WorkflowRun[] = [lifecycleFailedWorkflow];
    const lifecycleRequirements: RequirementDeliveryTicket[] = [
      lifecyclePlanRequirement,
      lifecycleRetryRequirement,
    ];
    let releaseConfirmPlan: (() => void) | undefined;
    const confirmPlanHold = new Promise<void>((resolve) => {
      releaseConfirmPlan = resolve;
    });

    await page.addInitScript(
      ([tokenKey, roleKey]) => {
        window.localStorage.setItem(tokenKey, "operator-token");
        window.localStorage.setItem(roleKey, "operator");
      },
      [apiTokenStorageKey, apiTokenRoleStorageKey],
    );
    await mockApi(page, lifecycleWorkflows, {
      requirements: lifecycleRequirements,
      onRequirementAction: async ({ action, id }) => {
        actions.push(`${action}:${id}`);

        if (id === "requirement-plan" && action === "confirm-plan") {
          await confirmPlanHold;
          return updateRequirement(lifecycleRequirements, id, {
            status: "ready_to_run",
            updatedAt: "2026-06-06T11:05:00.000Z",
          });
        }

        if (id === "requirement-plan" && action === "enqueue") {
          lifecycleWorkflows.push(lifecycleQueuedWorkflow);
          const nextRequirement = updateRequirement(
            lifecycleRequirements,
            id,
            {
              status: "running",
              currentWorkflowRunId: "workflow-lifecycle",
              runLinks: [
                {
                  workflowRunId: "workflow-lifecycle",
                  status: "ready",
                  linkedAt: "2026-06-06T11:06:00.000Z",
                },
              ],
              updatedAt: "2026-06-06T11:06:00.000Z",
            },
          );

          return {
            requirement: nextRequirement,
            workflow: lifecycleQueuedWorkflow,
            job: {
              id: "job-lifecycle",
              workflowId: "workflow-lifecycle",
              status: "queued",
              createdAt: "2026-06-06T11:06:00.000Z",
              updatedAt: "2026-06-06T11:06:00.000Z",
            },
          };
        }

        if (id === "requirement-retry" && action === "retry") {
          const nextRequirement = updateRequirement(
            lifecycleRequirements,
            id,
            {
              status: "ready_to_run",
              updatedAt: "2026-06-06T11:07:00.000Z",
              runLinks: [
                {
                  workflowRunId: "workflow-failed",
                  status: "ready",
                  linkedAt: "2026-06-06T11:07:00.000Z",
                },
              ],
            },
          );

          return {
            requirement: nextRequirement,
            workflow: {
              ...lifecycleFailedWorkflow,
              status: "ready",
              qualityGates: lifecycleFailedWorkflow.qualityGates.map((gate) => ({
                ...gate,
                status: "waiting",
                result: undefined,
              })),
            },
            retry: {
              previousStatus: "gate_failed",
              status: "ready",
            },
          };
        }

        throw new Error(`Unexpected requirement action ${action}:${id}`);
      },
    });

    await page.goto("/");

    const queue = page.locator(".requirementQueuePanel");
    const planItem = queue
      .locator(".requirementQueueItem")
      .filter({ hasText: "Confirm checkout plan" });
    await expect(planItem).toContainText("Plan review");

    await planItem.getByRole("button", { name: "Confirm plan" }).click();
    await expect(
      planItem.getByRole("button", { name: "Confirming plan" }),
    ).toBeDisabled();
    releaseConfirmPlan?.();

    await expect(planItem).toContainText("Ready to run");
    await expect
      .poll(() => actions.join("|"), {
        message: "wait for confirm plan action",
      })
      .toContain("confirm-plan:requirement-plan");

    await planItem.getByRole("button", { name: "Enqueue" }).click();
    await expect(planItem).toContainText("Running");
    await expect(
      planItem.getByRole("link", { name: /workflow-lifecycle/i }),
    ).toBeVisible();
    await expect(planItem).toContainText("Queued");

    const retryItem = queue
      .locator(".requirementQueueItem")
      .filter({ hasText: "Retry stale gate" });
    await expect(retryItem).toContainText("Needs rework");
    await expect(
      retryItem.getByRole("link", { name: /workflow-failed/i }),
    ).toBeVisible();
    await retryItem.getByRole("button", { name: "Retry" }).click();
    await expect(retryItem).toContainText("Ready to run");
    expect(actions).toEqual([
      "confirm-plan:requirement-plan",
      "enqueue:requirement-plan",
      "retry:requirement-retry",
    ]);
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
    onRequirementCreate?: (payload: unknown) => void;
    onRequirementAction?: (request: {
      action: "confirm-plan" | "enqueue" | "retry";
      authorization: string | undefined;
      id: string;
    }) => Promise<unknown> | unknown;
    onMutatingRequest?: (request: {
      method: string;
      pathname: string;
    }) => void;
    reports?: Record<string, unknown>;
    requirements?: RequirementDeliveryTicket[];
  } = {},
) {
  await page.unroute(`${API_ORIGIN}/**`).catch(() => undefined);

  await page.route(`${API_ORIGIN}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() !== "GET") {
      options.onMutatingRequest?.({
        method: request.method(),
        pathname: url.pathname,
      });
    }

    if (request.method() === "GET" && url.pathname === "/workflows") {
      options.onWorkflowRequest?.(request.headers().authorization);
      await route.fulfill({ json: workflows });
      return;
    }

    if (request.method() === "GET" && url.pathname === "/requirements") {
      await route.fulfill({ json: options.requirements ?? [] });
      return;
    }

    if (request.method() === "POST" && url.pathname === "/requirements") {
      if (request.headers().authorization === "Bearer viewer-token") {
        await route.fulfill({
          status: 403,
          json: {
            error: "forbidden",
            message: "This endpoint requires an operator token.",
            requiredRole: "operator",
            role: "viewer",
          },
        });
        return;
      }

      const payload = request.postDataJSON();
      options.onRequirementCreate?.(payload);
      await route.fulfill({
        status: 201,
        json: {
          id: "requirement-smoke-created",
          status: "plan_review",
          createdAt: "2026-06-06T10:30:00.000Z",
          updatedAt: "2026-06-06T10:30:00.000Z",
          ...(typeof payload === "object" && payload ? payload : {}),
        },
      });
      return;
    }

    const requirementReportMatch = url.pathname.match(
      /^\/requirements\/([^/]+)\/report$/,
    );
    if (request.method() === "GET" && requirementReportMatch) {
      const report = options.reports?.[requirementReportMatch[1] ?? ""];

      await route.fulfill(
        report
          ? { json: report }
          : { status: 409, json: { error: "report_not_ready" } },
      );
      return;
    }

    const requirementActionMatch = url.pathname.match(
      /^\/requirements\/([^/]+)\/(confirm-plan|enqueue|retry)$/,
    );
    if (request.method() === "POST" && requirementActionMatch) {
      if (request.headers().authorization === "Bearer viewer-token") {
        await route.fulfill({
          status: 403,
          json: {
            error: "forbidden",
            message: "This endpoint requires an operator token.",
            requiredRole: "operator",
            role: "viewer",
          },
        });
        return;
      }

      const [, id, action] = requirementActionMatch;
      const body = await options.onRequirementAction?.({
        action: action as "confirm-plan" | "enqueue" | "retry",
        authorization: request.headers().authorization,
        id,
      });
      await route.fulfill({
        status: action === "enqueue" ? 202 : 200,
        json: body ?? { error: "unhandled_requirement_action" },
      });
      return;
    }

    const workflow = workflows.find((item) =>
      url.pathname.startsWith(`/workflows/${item.id}`),
    );

    if (
      request.method() === "GET" &&
      workflow &&
      url.pathname === `/workflows/${workflow.id}/report`
    ) {
      const report = options.reports?.[workflow.id];

      await route.fulfill(
        report
          ? { json: report }
          : { status: 409, json: { error: "report_not_ready" } },
      );
      return;
    }

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

function updateRequirement(
  requirements: RequirementDeliveryTicket[],
  id: string,
  patch: Partial<RequirementDeliveryTicket>,
): RequirementDeliveryTicket {
  const index = requirements.findIndex((requirement) => requirement.id === id);
  expect(index).toBeGreaterThanOrEqual(0);

  requirements[index] = {
    ...(requirements[index] as RequirementDeliveryTicket),
    ...patch,
  };

  return requirements[index] as RequirementDeliveryTicket;
}

async function fillField(scope: Locator, label: RegExp, value: string) {
  const field = scope.getByLabel(label).first();
  await expect(field).toBeVisible();
  await field.fill(value);
}

async function chooseRisk(scope: Locator, value: string) {
  const risk = scope.getByLabel(/risk/i).first();
  if ((await risk.count()) === 0) {
    return;
  }

  await expect(risk).toBeVisible();
  await risk.selectOption(value).catch(async () => {
    await risk.fill(value);
  });
}

async function expectNoHorizontalDocumentOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    bodyScrollWidth: document.body.scrollWidth,
    documentClientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
  }));

  expect(dimensions.documentScrollWidth).toBeLessThanOrEqual(
    dimensions.documentClientWidth + 1,
  );
  expect(dimensions.bodyScrollWidth).toBeLessThanOrEqual(
    dimensions.documentClientWidth + 1,
  );
}

async function expectLabelsInsideViewport(page: Page, labels: string[]) {
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();

  for (const label of labels) {
    const locator = page.getByText(label, { exact: true }).first();
    await expect(locator).toBeVisible();
    const box = await locator.boundingBox();

    expect(box, `${label} should have a measurable box`).not.toBeNull();
    expect(box!.x, `${label} should not overflow left`).toBeGreaterThanOrEqual(
      0,
    );
    expect(
      box!.x + box!.width,
      `${label} should not overflow right`,
    ).toBeLessThanOrEqual(viewport!.width + 1);
  }
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

const mobileStressWorkflows: WorkflowRun[] = [
  {
    ...baseWorkflow,
    id: "workflow-mobile-gate-failed",
    goal: "Very long checkout acceptance requirement with no horizontal overflow",
    status: "gate_failed",
    repositoryPath:
      "C:/work/safety-console/checkout-with-a-very-long-repository-label",
    updatedAt: "2026-06-06T10:40:00.000Z",
    qualityGates: [
      {
        id: "gate-mobile-1",
        title: "Required smoke gate with long visible label",
        status: "failed",
      },
    ],
  },
  {
    ...baseWorkflow,
    id: "workflow-mobile-needs-review",
    goal: "Review evidence for a manually applied merge candidate",
    status: "needs_review",
    repositoryPath:
      "C:/work/safety-console/review-with-a-very-long-repository-label",
    updatedAt: "2026-06-06T10:45:00.000Z",
  },
];

const lifecycleFailedWorkflow: WorkflowRun = {
  ...baseWorkflow,
  id: "workflow-failed",
  goal: "Retry stale gate",
  status: "gate_failed",
  updatedAt: "2026-06-06T10:58:00.000Z",
  qualityGates: [
    {
      id: "gate-retry",
      title: "Unit tests",
      status: "failed",
      result: {
        exitCode: 1,
        stderr: "failing gate",
      },
    },
  ],
};

const lifecycleQueuedWorkflow: WorkflowRun = {
  ...baseWorkflow,
  id: "workflow-lifecycle",
  goal: "Confirm checkout plan",
  status: "ready",
  updatedAt: "2026-06-06T11:06:00.000Z",
};

const lifecyclePlanRequirement: RequirementDeliveryTicket = {
  id: "requirement-plan",
  title: "Confirm checkout plan",
  repositoryPath: "C:/work/shop",
  goal: "Run a confirmed checkout plan with isolated evidence.",
  acceptanceCriteria: ["Plan is confirmed before execution."],
  constraints: ["No MAWO auto-merge; manual git apply outside MAWO"],
  nonGoals: ["Automatic PR creation"],
  riskLevel: "medium",
  contextPaths: ["apps/web/src/app/page.tsx"],
  tasks: [
    {
      id: "task-plan",
      title: "Patch checkout copy",
      agent: "shell",
      instructions: "Patch checkout copy.",
    },
  ],
  qualityGates: [
    {
      id: "gate-plan",
      title: "Unit tests",
      command: "npm test",
      required: true,
    },
  ],
  status: "plan_review",
  runLinks: [],
  createdAt: "2026-06-06T11:00:00.000Z",
  updatedAt: "2026-06-06T11:00:00.000Z",
};

const lifecycleRetryRequirement: RequirementDeliveryTicket = {
  id: "requirement-retry",
  title: "Retry stale gate",
  repositoryPath: "C:/work/shop",
  goal: "Retry a failed gate without stale evidence.",
  acceptanceCriteria: ["Retry resets the current execution attempt."],
  constraints: ["No MAWO auto-merge; manual git apply outside MAWO"],
  nonGoals: ["Automatic PR creation"],
  riskLevel: "high",
  contextPaths: ["apps/web/src/app/page.tsx"],
  tasks: [
    {
      id: "task-retry",
      title: "Patch retry path",
      agent: "shell",
      instructions: "Patch retry path.",
    },
  ],
  qualityGates: [
    {
      id: "gate-retry",
      title: "Unit tests",
      command: "npm test",
      required: true,
    },
  ],
  status: "needs_rework",
  currentWorkflowRunId: "workflow-failed",
  runLinks: [
    {
      workflowRunId: "workflow-failed",
      status: "gate_failed",
      linkedAt: "2026-06-06T10:58:00.000Z",
    },
  ],
  createdAt: "2026-06-06T10:50:00.000Z",
  updatedAt: "2026-06-06T10:58:00.000Z",
};

const requirementTickets: RequirementDeliveryTicket[] = [
  {
    id: "requirement-viewer-readable",
    title: "Viewer readable requirement",
    repositoryPath: "C:/work/shop",
    goal: "Review requirement evidence without mutating state.",
    acceptanceCriteria: [
      "Viewer can read the requirement list.",
      "Viewer cannot create or modify requirements.",
    ],
    constraints: ["No MAWO auto-merge; manual git apply outside MAWO"],
    nonGoals: ["Automatic PR creation"],
    riskLevel: "medium",
    contextPaths: ["apps/web/src/app/page.tsx"],
    tasks: [
      {
        id: "task-view",
        title: "Inspect evidence",
        agent: "shell",
        instructions: "Review evidence without making changes.",
      },
    ],
    qualityGates: [
      {
        id: "gate-view",
        title: "Evidence visible",
        command: "npm test",
        required: true,
      },
    ],
    status: "needs_review",
    currentWorkflowRunId: "workflow-needs-review",
    runLinks: [
      {
        workflowRunId: "workflow-needs-review",
        status: "needs_review",
        linkedAt: "2026-06-06T10:25:00.000Z",
      },
    ],
    createdAt: "2026-06-06T10:20:00.000Z",
    updatedAt: "2026-06-06T10:25:00.000Z",
  },
];

const requirementEvidenceReport = {
  workflowId: "workflow-needs-review",
  reportArtifactPath: "C:/mawo/artifacts/workflow-needs-review/report.json",
  summary: "1/1 tasks passed; 1/1 gates passed",
  recommendation: "ready_for_review",
  failedTasks: [],
  failedGates: [],
  taskResults: [
    {
      id: "task-view",
      title: "Inspect evidence",
      status: "passed",
      stdoutArtifactPath:
        "C:/mawo/artifacts/workflow-needs-review/tasks/task-view/stdout.txt",
      stderrArtifactPath:
        "C:/mawo/artifacts/workflow-needs-review/tasks/task-view/stderr.txt",
      patchArtifactPath:
        "C:/mawo/artifacts/workflow-needs-review/tasks/task-view/patch.diff",
    },
  ],
  gateResults: [
    {
      id: "gate-view",
      title: "Evidence visible",
      status: "passed",
      stdoutArtifactPath:
        "C:/mawo/artifacts/workflow-needs-review/gates/gate-view/stdout.txt",
    },
  ],
};

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
