import { expect, test, type Locator, type Page } from "@playwright/test";
import type {
  RepositorySafety,
  RequirementDeliveryTicket,
  WorkflowJob,
  WorkflowRun,
} from "@mawo/shared";

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
    const deliveryHealth = consoleShell.getByLabel("Delivery health");
    await expect(deliveryHealth).toContainText("API Ready");
    await expect(deliveryHealth).toContainText("Worker No Workers");
    await expect(deliveryHealth).toContainText("Queue 0");
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

    const focusPanel = page.locator(".deliveryFocusPanel");
    await expect(
      focusPanel.getByRole("heading", { name: "Update billing copy" }),
    ).toBeVisible();
    await decisionQueue.getByText("Review merge candidate").click();
    await expect(
      focusPanel.getByRole("heading", { name: "Harden auth checks" }),
    ).toBeVisible();
    await expect(focusPanel.getByLabel("Repository Safety")).toContainText(
      "C:/work/auth-service",
    );
    await requirementQueue
      .getByRole("button", { name: "Select requirement Update billing copy" })
      .click();
    await expect(
      focusPanel.getByRole("heading", { name: "Update billing copy" }),
    ).toBeVisible();
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
    await expect(
      consoleShell.getByRole("button", {
        name: /apply candidate|apply patch/i,
      }),
    ).toHaveCount(0);
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

  test("surfaces registered dirty repository safety before enqueue", async ({
    page,
  }) => {
    await mockApi(page, [], {
      repositorySafetyByRepositoryId: {
        "repo-dirty": dirtyRepositorySafety,
      },
      requirements: [dirtyRepositoryRequirement],
    });

    await page.goto("/");

    const safety = page.getByLabel("Repository Safety");
    await expect(safety).toContainText("Safety blocked");
    await expect(safety).toContainText("feature/checkout");
    await expect(safety).toContainText("HEAD abc1234");
    await expect(safety).toContainText("Dirty - mutating runs blocked");
    await expect(safety).toContainText("Allowed root accepted by API");
    await expect(safety).toContainText(
      "Repository has uncommitted changes; mutating requirement runs are blocked.",
    );
    await expect(safety).toContainText(
      "Commit, stash, or discard local changes before running mutating workflows.",
    );
    const queueItem = page
      .locator(".requirementQueueItem")
      .filter({ hasText: "Run dirty repo safely" });
    await expect(queueItem).toContainText("Repository safety blocks execution");
    await expect(
      queueItem.getByRole("button", { name: "Enqueue" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /apply candidate|apply patch/i }),
    ).toHaveCount(0);
  });

  test("surfaces readable review evidence and artifact paths for requirement tickets", async ({
    page,
  }) => {
    await mockApi(page, mixedWorkflows, {
      mergeCandidates: {
        "requirement-viewer-readable": requirementMergeCandidate,
      },
      reports: {
        "requirement-viewer-readable": requirementEvidenceReport,
      },
      requirements: requirementTickets,
    });

    await page.goto("/");

    const evidence = page.getByLabel("Gate Result / Review Evidence");
    await expect(evidence).toContainText(
      "Merge candidate ready with 2 changed files",
    );
    await expect(evidence).toContainText(
      "1/1 tasks passed; 1 required gate passed; 1 optional gate failed",
    );
    await expect(evidence).toContainText("apps/web/src/app/page.tsx");
    await expect(evidence).toContainText("packages/shared/src/index.ts");
    await expect(evidence).toContainText(
      "C:/mawo/artifacts/workflow-needs-review/merge-candidate.patch",
    );
    await expect(evidence).toContainText(
      'git -C "C:/work/shop" apply "C:/mawo/artifacts/workflow-needs-review/merge-candidate.patch"',
    );
    await expect(evidence).toContainText(
      "1 required passed: Evidence visible passed: npm test",
    );
    await expect(evidence).toContainText(
      "1 optional reported issues: Visual smoke failed (exit 1): npm run smoke:ui; does not block merge approval",
    );
    await expect(evidence).not.toContainText("RAW_STDOUT_SHOULD_NOT_RENDER");
    await expect(evidence).not.toContainText("diff --git");

    const evidenceDrawer = evidence.getByLabel("Read-only evidence links");
    await evidenceDrawer.getByText("Evidence links", { exact: true }).click();

    await expect(
      evidenceDrawer.getByLabel("Artifact group Run output"),
    ).toContainText("2 links");
    await expect(
      evidenceDrawer.getByLabel("Artifact group Errors"),
    ).toContainText("1 link");
    await expect(
      evidenceDrawer.getByLabel("Artifact group Patches"),
    ).toContainText("3 links");
    await expect(
      evidenceDrawer.getByLabel("Artifact group Reports"),
    ).toContainText("3 links");
    await expect(
      evidenceDrawer.getByLabel("Artifact group Audit"),
    ).toContainText("1 link");
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
    await expect(
      evidenceDrawer.getByRole("link", {
        name: "Merge candidate patch artifact",
      }),
    ).toBeVisible();
    await expect(
      evidenceDrawer.getByRole("link", { name: "Merge candidate manifest" }),
    ).toBeVisible();

    await page.locator(".requirementDetailDisclosure > summary").click();
    const detail = page.locator(".requirementDetailShell");
    await expect(detail).toBeVisible();
    await expect(detail).toContainText(
      'git -C "C:/work/shop" apply "C:/mawo/artifacts/workflow-needs-review/merge-candidate.patch"',
    );
    await expect(detail.getByLabel("Changed files under review")).toContainText(
      "2 files changed",
    );
    await expect(detail.getByLabel("Changed files under review")).toContainText(
      "apps/web/src/app/page.tsx",
    );
    await expect(detail.getByLabel("Changed files under review")).toContainText(
      "packages/shared/src/index.ts",
    );
    const valueReport = detail.getByLabel("Value report summary");
    await expect(valueReport).toContainText("Report recommendation");
    await expect(valueReport).toContainText("Ready for review");
    await expect(valueReport).toContainText(
      "1/1 tasks passed; 1 required gate passed; 1 optional gate failed",
    );
    await expect(valueReport).toContainText(
      "Review required before manual apply",
    );
    await expect(valueReport).toContainText(
      "Current workflow workflow-needs-review",
    );
    await expect(valueReport).not.toContainText("RAW_STDOUT_SHOULD_NOT_RENDER");
    await expect(detail).not.toContainText("RAW_STDOUT_SHOULD_NOT_RENDER");
    await expect(detail).not.toContainText("diff --git");
    const detailDrawer = page.locator(".requirementDetailShell .artifactDrawer");
    await detailDrawer.getByText("Artifacts", { exact: true }).click();
    await expect(
      detailDrawer.getByRole("link", { name: "Inspect evidence stdout" }),
    ).toBeVisible();
    await expect(
      detailDrawer.getByRole("link", { name: "Report artifact" }),
    ).toBeVisible();
    await expect(
      detailDrawer.getByRole("link", {
        name: "Merge candidate patch artifact",
      }),
    ).toBeVisible();
  });

  test("keeps gate failed and review evidence visible", async ({ page }) => {
    const mutatingRequests: string[] = [];

    await mockApi(page, mixedWorkflows, {
      onMutatingRequest: ({ method, pathname }) => {
        mutatingRequests.push(`${method} ${pathname}`);
      },
      reports: {
        "requirement-gate-failed": gateFailedEvidenceReport,
      },
      requirements: gateFailedRequirementTickets,
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
    await expect(evidence).toContainText(
      "1 required reported issues: Copy checks failed (exit 1): npm run copy:check; blocks merge approval",
    );
    await expect(evidence).not.toContainText("RAW_GATE_STDOUT_SHOULD_NOT_RENDER");
    await expect(evidence).not.toContainText("RAW_GATE_STDERR_SHOULD_NOT_RENDER");

    const blockedDrawer = evidence.getByLabel("Read-only evidence links");
    await blockedDrawer.getByText("Evidence links", { exact: true }).click();
    await expect(
      blockedDrawer.getByRole("link", { name: "Copy checks stdout" }),
    ).toBeVisible();
    await expect(
      blockedDrawer.getByRole("link", { name: "Copy checks stderr" }),
    ).toBeVisible();
    await expect(
      evidence.getByRole("button", { name: /apply candidate/i }),
    ).toHaveCount(0);

    await page.locator(".requirementDetailDisclosure > summary").click();
    const detail = page.locator(".requirementDetailShell");
    const failedValueReport = detail.getByLabel("Value report summary");
    await expect(failedValueReport).toContainText("Fix failed gates");
    await expect(failedValueReport).toContainText(
      "1/1 tasks passed; 0/1 gates passed",
    );
    await expect(failedValueReport).toContainText(
      "Goal not achieved; rework required",
    );
    await expect(failedValueReport).toContainText("Required gate failed");
    await expect(failedValueReport).toContainText(
      "Current workflow workflow-gate-failed",
    );
    await expect(failedValueReport).not.toContainText(
      "RAW_GATE_STDOUT_SHOULD_NOT_RENDER",
    );
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
      evidenceDrawer.getByLabel("Artifact group Patches"),
    ).toContainText("1 link");
    await expect(
      evidenceDrawer.getByLabel("Artifact group Reports"),
    ).toContainText("1 link");
    await expect(
      evidenceDrawer.getByLabel("Artifact group Audit"),
    ).toContainText("1 link");
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

  test("operator can approve a review-ready requirement from the detail shell", async ({
    page,
  }) => {
    const mutatingRequests: string[] = [];
    const reviewRequests: Array<{
      authorization: string | undefined;
      decision: string;
      workflowId: string;
    }> = [];
    const reviewWorkflows: WorkflowRun[] = [
      mixedWorkflows[1] as WorkflowRun,
    ];
    const reviewRequirements: RequirementDeliveryTicket[] = [
      { ...(requirementTickets[0] as RequirementDeliveryTicket) },
    ];

    await page.addInitScript(
      ([tokenKey, roleKey]) => {
        window.localStorage.setItem(tokenKey, "operator-token");
        window.localStorage.setItem(roleKey, "operator");
      },
      [apiTokenStorageKey, apiTokenRoleStorageKey],
    );
    await mockApi(page, reviewWorkflows, {
      requirements: reviewRequirements,
      onMutatingRequest: ({ method, pathname }) => {
        mutatingRequests.push(`${method} ${pathname}`);
      },
      onWorkflowReview: ({ authorization, decision, workflowId }) => {
        reviewRequests.push({ authorization, decision, workflowId });
        reviewWorkflows[0] = {
          ...(reviewWorkflows[0] as WorkflowRun),
          status: "completed",
          review: {
            decision: "approved",
            note: "Approved from Requirement Delivery Console",
            reviewedAt: "2026-06-06T11:20:00.000Z",
          },
          updatedAt: "2026-06-06T11:20:00.000Z",
        };
        updateRequirement(reviewRequirements, "requirement-viewer-readable", {
          status: "delivered",
          updatedAt: "2026-06-06T11:20:00.000Z",
          runLinks: [
            {
              workflowRunId: "workflow-needs-review",
              status: "completed",
              linkedAt: "2026-06-06T11:20:00.000Z",
            },
          ],
        });

        return reviewWorkflows[0];
      },
    });

    await page.goto("/");

    await expectMetric(page, "Waiting Review", "1");
    await expect(page.locator(".decisionQueuePanel")).toContainText(
      "Review merge candidate",
    );
    await page.locator(".requirementDetailDisclosure > summary").click();

    const detail = page.locator(".requirementDetailShell");
    const reviewActions = detail.getByLabel("Review actions");
    await expect(
      reviewActions.getByRole("button", { name: "Approve" }),
    ).toBeEnabled();
    await expect(
      reviewActions.getByRole("button", { name: "Reject" }),
    ).toBeEnabled();
    await reviewActions.getByRole("button", { name: "Approve" }).click();

    await expect
      .poll(() => reviewRequests, {
        message: "wait for workflow review request",
      })
      .toEqual([
        {
          authorization: "Bearer operator-token",
          decision: "approve",
          workflowId: "workflow-needs-review",
        },
      ]);
    await expect(page.getByLabel("Review decision")).toContainText(
      "Review approved: Viewer readable requirement",
    );
    await expectMetric(page, "Waiting Review", "0");
    await expect(page.locator(".decisionQueuePanel")).not.toContainText(
      "Review merge candidate",
    );
    await expect(page.getByLabel("Gate Result / Review Evidence")).toContainText(
      "Approved delivery",
    );
    expect(mutatingRequests).toEqual([
      "POST /workflows/workflow-needs-review/review",
    ]);
    expect(mutatingRequests).not.toContain(
      "POST /workflows/workflow-needs-review/merge-candidate/apply",
    );
    await expect(
      page.getByRole("button", { name: /apply candidate|apply patch/i }),
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
    await expect(
      mobileEvidenceDrawer.getByLabel("Artifact group Reports"),
    ).toContainText("1 link");
    await expect(
      mobileEvidenceDrawer.getByLabel("Artifact group Audit"),
    ).toContainText("1 link");
    await expectNoHorizontalDocumentOverflow(page);
    await expectElementsInsideViewport(
      page,
      page.locator(".repositorySafetyCard"),
    );
    await expectElementsInsideViewport(
      page,
      page.locator(".repositorySafetyList dd"),
    );
    await expectElementsInsideViewport(
      page,
      page.locator(".requirementEvidenceCard"),
    );
    await expectLabelsInsideViewport(page, [
      "Evidence links",
      "Reports",
      "Audit",
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
    await fillField(flow, /task 1 title/i, "Create the checkout copy patch.");
    await fillField(flow, /task 1 command/i, "npm run patch:checkout");
    await fillField(flow, /task 1 timeout/i, "90000");
    await fillField(flow, /task 2 title/i, "Review checkout evidence.");
    await chooseTaskAgent(flow, /task 2 agent/i, "codex");
    await fillField(flow, /task 2 instructions/i, "Review the generated patch.");
    await fillField(flow, /task 2 depends/i, "task-1");
    await fillField(flow, /quality gate|gate/i, "npm test\noptional: npm run smoke:ui");
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
          id: "task-1",
          title: expect.stringMatching(/checkout copy patch/i),
          agent: "shell",
          command: "npm run patch:checkout",
          timeoutMs: 90000,
        }),
        expect.objectContaining({
          id: "task-2",
          title: "Review checkout evidence.",
          agent: "codex",
          instructions: "Review the generated patch.",
          dependsOn: ["task-1"],
        }),
      ]),
      qualityGates: expect.arrayContaining([
        expect.objectContaining({
          command: "npm test",
          required: true,
        }),
        expect.objectContaining({
          command: "npm run smoke:ui",
          required: false,
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
              updatedAt: "2026-06-06T11:07:00.000Z",
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

    await planItem
      .getByRole("button", { exact: true, name: "Confirm plan" })
      .click();
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

    await planItem
      .getByRole("button", { exact: true, name: "Enqueue" })
      .click();
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
    await retryItem
      .getByRole("button", { exact: true, name: "Retry" })
      .click();
    await expect(page.getByLabel("Workflow sync")).toContainText(
      "Retry reset to ready. Enqueue to run fresh evidence.",
    );
    await expect(retryItem).toContainText(
      "Retry reset to ready. Enqueue to run fresh evidence.",
    );
    await expect(retryItem).toContainText("Ready to run");
    await expect(retryItem).toContainText("Ready");
    await expect(retryItem).toContainText("Enqueue");
    await expect(retryItem).not.toContainText("Gate failed");
    await expect(retryItem).not.toContainText("Required gate failed");
    await expect(retryItem).not.toContainText("failing gate");
    expect(actions).toEqual([
      "confirm-plan:requirement-plan",
      "enqueue:requirement-plan",
      "retry:requirement-retry",
    ]);
  });

  test("automatically refreshes active requirement jobs after enqueue", async ({
    page,
  }) => {
    const workflows: WorkflowRun[] = [];
    const requirements: RequirementDeliveryTicket[] = [
      {
        ...lifecyclePlanRequirement,
        id: "requirement-auto-refresh",
        title: "Auto refresh checkout evidence",
        status: "ready_to_run",
        updatedAt: "2026-06-06T11:10:00.000Z",
      },
    ];
    let jobPolls = 0;

    await page.addInitScript(
      ([tokenKey, roleKey]) => {
        window.localStorage.setItem(tokenKey, "operator-token");
        window.localStorage.setItem(roleKey, "operator");
      },
      [apiTokenStorageKey, apiTokenRoleStorageKey],
    );
    await mockApi(page, workflows, {
      requirements,
      onRequirementAction: ({ action, id }) => {
        if (id !== "requirement-auto-refresh" || action !== "enqueue") {
          throw new Error(`Unexpected action ${action}:${id}`);
        }

        workflows.push({
          ...lifecycleQueuedWorkflow,
          id: "workflow-auto-refresh",
          goal: "Auto refresh checkout evidence",
          status: "ready",
          updatedAt: "2026-06-06T11:11:00.000Z",
        });

        return {
          requirement: updateRequirement(requirements, id, {
            status: "running",
            currentWorkflowRunId: "workflow-auto-refresh",
            runLinks: [
              {
                workflowRunId: "workflow-auto-refresh",
                status: "ready",
                linkedAt: "2026-06-06T11:11:00.000Z",
              },
            ],
            updatedAt: "2026-06-06T11:11:00.000Z",
          }),
          workflow: workflows[0],
          job: {
            id: "job-auto-refresh",
            workflowId: "workflow-auto-refresh",
            status: "queued",
            createdAt: "2026-06-06T11:11:00.000Z",
            updatedAt: "2026-06-06T11:11:00.000Z",
          },
        };
      },
      onJobRequest: ({ id }) => {
        if (id !== "job-auto-refresh") {
          throw new Error(`Unexpected job poll ${id}`);
        }

        jobPolls += 1;

        if (jobPolls < 2) {
          return {
            id,
            workflowId: "workflow-auto-refresh",
            status: "running",
            createdAt: "2026-06-06T11:11:00.000Z",
            updatedAt: "2026-06-06T11:11:01.000Z",
          };
        }

        workflows[0] = {
          ...workflows[0]!,
          status: "needs_review",
          updatedAt: "2026-06-06T11:12:00.000Z",
        };
        updateRequirement(requirements, "requirement-auto-refresh", {
          status: "needs_review",
          runLinks: [
            {
              workflowRunId: "workflow-auto-refresh",
              status: "needs_review",
              linkedAt: "2026-06-06T11:12:00.000Z",
            },
          ],
          updatedAt: "2026-06-06T11:12:00.000Z",
        });

        return {
          id,
          workflowId: "workflow-auto-refresh",
          status: "completed",
          createdAt: "2026-06-06T11:11:00.000Z",
          updatedAt: "2026-06-06T11:12:00.000Z",
          finishedAt: "2026-06-06T11:12:00.000Z",
        };
      },
    });

    await page.goto("/");

    const queueItem = page
      .locator(".requirementQueueItem")
      .filter({ hasText: "Auto refresh checkout evidence" });
    await expect(queueItem).toContainText("Ready to run");

    await queueItem
      .getByRole("button", { exact: true, name: "Enqueue" })
      .click();
    await expect(queueItem).toContainText("Running");
    await expect(queueItem).toContainText("Queued");
    await expect
      .poll(() => jobPolls, {
        message: "wait for the client to poll the active job",
      })
      .toBeGreaterThan(0);
    await expect(queueItem).toContainText("Needs review");
    await expect(queueItem).toContainText("Review merge candidate");
    await expect(queueItem).not.toContainText("Queued");
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
    onWorkflowReview?: (request: {
      authorization: string | undefined;
      decision: "approve" | "reject";
      workflowId: string;
    }) => Promise<unknown> | unknown;
    onMutatingRequest?: (request: {
      method: string;
      pathname: string;
    }) => void;
    onJobRequest?: (request: { id: string }) => WorkflowJob | unknown;
    mergeCandidates?: Record<string, unknown>;
    reports?: Record<string, unknown>;
    repositorySafetyByRepositoryId?: Record<string, RepositorySafety>;
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

    const jobMatch = url.pathname.match(/^\/jobs\/([^/]+)$/);
    if (request.method() === "GET" && jobMatch) {
      const id = decodeURIComponent(jobMatch[1] ?? "");
      const job = options.onJobRequest?.({ id }) ?? {
        id,
        workflowId: "",
        status: "queued",
        createdAt: "2026-06-06T11:00:00.000Z",
        updatedAt: "2026-06-06T11:00:00.000Z",
      };

      await route.fulfill({ json: job });
      return;
    }

    const repositorySafetyMatch = url.pathname.match(
      /^\/repositories\/([^/]+)\/safety$/,
    );
    if (request.method() === "GET" && repositorySafetyMatch) {
      const repositoryId = decodeURIComponent(repositorySafetyMatch[1] ?? "");
      const safety = options.repositorySafetyByRepositoryId?.[repositoryId];

      await route.fulfill(
        safety
          ? { json: safety }
          : { status: 404, json: { error: "repository_not_found" } },
      );
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

    const requirementMergeCandidateMatch = url.pathname.match(
      /^\/requirements\/([^/]+)\/merge-candidate$/,
    );
    if (request.method() === "GET" && requirementMergeCandidateMatch) {
      const mergeCandidate =
        options.mergeCandidates?.[requirementMergeCandidateMatch[1] ?? ""];

      await route.fulfill(
        mergeCandidate
          ? { json: mergeCandidate }
          : { status: 409, json: { error: "merge_candidate_not_ready" } },
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
      url.pathname === `/workflows/${workflow.id}/merge-candidate`
    ) {
      const mergeCandidate = options.mergeCandidates?.[workflow.id];

      await route.fulfill(
        mergeCandidate
          ? { json: mergeCandidate }
          : { status: 409, json: { error: "merge_candidate_not_ready" } },
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

    if (
      request.method() === "POST" &&
      workflow &&
      url.pathname === `/workflows/${workflow.id}/review`
    ) {
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

      const payload = request.postDataJSON() as {
        decision?: "approve" | "reject";
      };
      const body = await options.onWorkflowReview?.({
        authorization: request.headers().authorization,
        decision: payload.decision ?? "approve",
        workflowId: workflow.id,
      });
      await route.fulfill({
        status: 200,
        json: body ?? workflow,
      });
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

async function chooseTaskAgent(scope: Locator, label: RegExp, value: string) {
  const agent = scope.getByLabel(label).first();
  await expect(agent).toBeVisible();
  await agent.selectOption(value);
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

async function expectElementsInsideViewport(page: Page, locator: Locator) {
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();

  const count = await locator.count();
  expect(count).toBeGreaterThan(0);

  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);
    const box = await item.boundingBox();

    expect(box, `element ${index} should have a measurable box`).not.toBeNull();
    expect(
      box!.x,
      `element ${index} should not overflow left`,
    ).toBeGreaterThanOrEqual(0);
    expect(
      box!.x + box!.width,
      `element ${index} should not overflow right`,
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
      required: true,
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
        required: true,
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

const gateFailedRequirementTickets: RequirementDeliveryTicket[] = [
  {
    id: "requirement-gate-failed",
    title: "Update billing copy",
    repositoryPath: "C:/work/shop",
    goal: "Make billing copy changes reviewable after required gates.",
    acceptanceCriteria: ["Failed required gate blocks merge approval."],
    constraints: ["No MAWO auto-merge; manual git apply outside MAWO"],
    nonGoals: ["Automatic PR creation"],
    riskLevel: "high",
    contextPaths: ["apps/web/src/app/page.tsx"],
    tasks: [
      {
        id: "task-copy",
        title: "Patch billing copy",
        agent: "shell",
        instructions: "Patch billing copy.",
      },
    ],
    qualityGates: [
      {
        id: "gate-1",
        title: "Copy checks",
        command: "npm run copy:check",
        required: true,
      },
    ],
    status: "needs_rework",
    currentWorkflowRunId: "workflow-gate-failed",
    runLinks: [
      {
        workflowRunId: "workflow-gate-failed",
        status: "gate_failed",
        linkedAt: "2026-06-06T10:00:00.000Z",
      },
    ],
    createdAt: "2026-06-06T09:55:00.000Z",
    updatedAt: "2026-06-06T10:00:00.000Z",
  },
];

const dirtyRepositoryRequirement: RequirementDeliveryTicket = {
  id: "requirement-dirty-repo",
  title: "Run dirty repo safely",
  repositoryId: "repo-dirty",
  repositoryPath: "C:/work/shop",
  goal: "Block mutating runs until repository safety is clear.",
  acceptanceCriteria: ["Dirty repository state is visible before enqueue."],
  constraints: ["No MAWO auto-merge; manual git apply outside MAWO"],
  nonGoals: ["Automatic PR creation"],
  riskLevel: "high",
  contextPaths: ["apps/web/src/app/page.tsx"],
  tasks: [
    {
      id: "task-dirty",
      title: "Patch checkout",
      agent: "shell",
      instructions: "Patch checkout after the repository is clean.",
    },
  ],
  qualityGates: [
    {
      id: "gate-dirty",
      title: "Unit tests",
      command: "npm test",
      required: true,
    },
  ],
  status: "ready_to_run",
  runLinks: [],
  createdAt: "2026-06-06T11:00:00.000Z",
  updatedAt: "2026-06-06T11:05:00.000Z",
};

const dirtyRepositorySafety: RepositorySafety = {
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
};

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
        required: true,
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
      required: true,
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
      {
        id: "gate-visual",
        title: "Visual smoke",
        command: "npm run smoke:ui",
        required: false,
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
  summary: "1/1 tasks passed; 1 required gate passed; 1 optional gate failed",
  recommendation: "ready_for_review",
  failedTasks: [],
  failedGates: [],
  taskResults: [
    {
      id: "task-view",
      title: "Inspect evidence",
      status: "passed",
      stdout: "RAW_STDOUT_SHOULD_NOT_RENDER",
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
    {
      id: "gate-visual",
      title: "Visual smoke",
      status: "failed",
      exitCode: 1,
    },
  ],
};

const gateFailedEvidenceReport = {
  workflowId: "workflow-gate-failed",
  reportArtifactPath: "C:/mawo/artifacts/workflow-gate-failed/report.json",
  summary: "1/1 tasks passed; 0/1 gates passed",
  recommendation: "fix_failed_gates",
  failedTasks: [],
  failedGates: ["gate-1"],
  taskResults: [
    {
      id: "task-copy",
      title: "Patch billing copy",
      status: "passed",
    },
  ],
  gateResults: [
    {
      id: "gate-1",
      title: "Copy checks",
      status: "failed",
      exitCode: 1,
      stdout: "RAW_GATE_STDOUT_SHOULD_NOT_RENDER",
      stderr: "RAW_GATE_STDERR_SHOULD_NOT_RENDER",
      stdoutArtifactPath:
        "C:/mawo/artifacts/workflow-gate-failed/gates/gate-1/stdout.txt",
      stderrArtifactPath:
        "C:/mawo/artifacts/workflow-gate-failed/gates/gate-1/stderr.txt",
    },
  ],
};

const requirementMergeCandidate = {
  workflowId: "workflow-needs-review",
  status: "ready",
  summary: "Merge candidate ready with 2 changed files",
  sourceBranches: ["mawo/workflow-needs-review/task-view"],
  patch: [
    "diff --git a/apps/web/src/app/page.tsx b/apps/web/src/app/page.tsx",
    "index 1111111..2222222 100644",
    "--- a/apps/web/src/app/page.tsx",
    "+++ b/apps/web/src/app/page.tsx",
    "@@ -1 +1 @@",
    "-old",
    "+new",
    "diff --git a/packages/shared/src/index.ts b/packages/shared/src/index.ts",
    "index 3333333..4444444 100644",
    "--- a/packages/shared/src/index.ts",
    "+++ b/packages/shared/src/index.ts",
  ].join("\n"),
  patchArtifactPath:
    "C:/mawo/artifacts/workflow-needs-review/merge-candidate.patch",
  manifestArtifactPath:
    "C:/mawo/artifacts/workflow-needs-review/merge-candidate.json",
  applyCommand:
    'git -C "C:/work/shop" apply "C:/mawo/artifacts/workflow-needs-review/merge-candidate.patch"',
  createdAt: "2026-06-06T10:26:00.000Z",
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
