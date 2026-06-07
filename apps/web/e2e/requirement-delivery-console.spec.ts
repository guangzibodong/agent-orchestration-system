import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  AgentHealth,
  AuditEvent,
  LaunchGateEvidence,
  RepositorySafety,
  RequirementDeliveryTicket,
  WorkflowJob,
  WorkflowRun,
} from "@mawo/shared";

const API_ORIGIN = "http://127.0.0.1:4000";
const apiTokenStorageKey = "mawo-api-token";
const apiTokenRoleStorageKey = "mawo-api-token-role";
const screenshotEvidenceDir = join(
  process.cwd(),
  "output",
  "playwright",
  "requirement-delivery-console",
);

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
    await expect(deliveryHealth).toContainText("Launch Development ready");
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

  test("filters requirement and decision queues from the topbar search", async ({
    page,
  }) => {
    const mutatingRequests: string[] = [];

    await mockApi(page, mixedWorkflows, {
      onMutatingRequest: ({ method, pathname }) => {
        mutatingRequests.push(`${method} ${pathname}`);
      },
    });

    await page.goto("/");

    const consoleShell = page.locator("main.deliveryShell");
    const search = consoleShell.getByLabel("Search requirements, repos, reports");
    const requirementQueue = page.locator(".requirementQueuePanel");
    const decisionQueue = page.locator(".decisionQueuePanel");
    const focusPanel = page.locator(".deliveryFocusPanel");

    await search.fill("billing");
    await expect(requirementQueue).toContainText("1 active");
    await expect(requirementQueue).toContainText("Update billing copy");
    await expect(requirementQueue).not.toContainText("Harden auth checks");
    await expect(decisionQueue).toContainText("1 waiting");
    await expect(decisionQueue).toContainText("Retry failed gate");
    await expect(decisionQueue).not.toContainText("Review merge candidate");
    await expect(
      focusPanel.getByRole("heading", { name: "Update billing copy" }),
    ).toBeVisible();

    await search.fill("auth-service");
    await expect(requirementQueue).toContainText("1 active");
    await expect(requirementQueue).toContainText("Harden auth checks");
    await expect(requirementQueue).not.toContainText("Update billing copy");
    await expect(decisionQueue).toContainText("1 waiting");
    await expect(decisionQueue).toContainText("Review merge candidate");
    await expect(decisionQueue).not.toContainText("Retry failed gate");
    await expect(
      focusPanel.getByRole("heading", { name: "Harden auth checks" }),
    ).toBeVisible();

    await search.fill("no matching requirement");
    await expect(requirementQueue).toContainText("0 active");
    await expect(requirementQueue).toContainText("No matching requirements");
    await expect(decisionQueue).toContainText("0 waiting");
    await expect(decisionQueue).toContainText("No matching decisions");
    await expect(focusPanel).toContainText("No requirement selected");
    expect(mutatingRequests).toEqual([]);
  });

  test("surfaces stale launch gate evidence in delivery health", async ({
    page,
  }) => {
    await mockApi(page, [], {
      launchGateEvidence: {
        generatedAt: "2026-06-06T17:23:13.647Z",
        root: "C:/work/mawo",
        branch: "main",
        commit: "847c137",
        dirtyFiles: [],
        checks: [],
        docs: ["docs/product/REQUIREMENTS_FREEZE.md"],
        localDecision: "passed",
        productionDecision: "blocked",
        failureSummaries: [],
        externalBlockers: [],
        currentBranch: "main",
        currentCommit: "next-head",
        currentDirtyFiles: [],
        fresh: false,
        staleReasons: [
          "Evidence commit 847c137 does not match HEAD next-head.",
        ],
      },
    });

    await page.goto("/");

    const deliveryHealth = page
      .locator("main.deliveryShell")
      .getByLabel("Delivery health");
    await expect(deliveryHealth).toContainText("Launch Evidence stale");
    await expect(deliveryHealth).toContainText(
      "Queue 0",
    );
    await expect(
      deliveryHealth.getByLabel(
        "Launch Evidence stale: Evidence commit 847c137 does not match HEAD next-head.",
      ),
    ).toBeVisible();
    await expect(
      deliveryHealth.locator(".deliveryHealthIndicator.danger"),
    ).toContainText(
      "Evidence stale",
    );
  });

  test("surfaces launch gate external blockers in delivery health", async ({
    page,
  }) => {
    await mockApi(page, [], {
      launchGateEvidence: {
        generatedAt: "2026-06-06T17:56:06.605Z",
        root: "C:/work/mawo",
        branch: "main",
        commit: "8c48bb6",
        dirtyFiles: [],
        checks: [],
        docs: ["docs/product/REQUIREMENTS_FREEZE.md"],
        localDecision: "passed",
        productionDecision: "blocked",
        failureSummaries: [],
        externalBlockers: [
          "db_validate: DATABASE_URL is not configured for Postgres launch verification.",
          "db_migrate_deploy: DATABASE_URL is not configured for Postgres launch verification.",
          "smoke_api_postgres: DATABASE_URL is not configured for Postgres launch verification.",
        ],
      },
    });

    await page.goto("/");

    const deliveryHealth = page
      .locator("main.deliveryShell")
      .getByLabel("Delivery health");
    await expect(deliveryHealth).toContainText(
      "Launch Local passed / Prod blocked",
    );
    await expect(
      deliveryHealth.getByLabel(
        "Launch Local passed / Prod blocked: Postgres launch verification blocked: DATABASE_URL is not configured for Postgres launch verification. 2 more external blockers. Generated 2026-06-06T17:56:06.605Z",
      ),
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
      "Operator token required",
    );
    await expect(page.locator(".decisionQueuePanel")).not.toContainText(
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
      const cancelResponse = await fetch(`${origin}/jobs/job-viewer/cancel`, {
        method: "POST",
        headers,
      });

      return {
        readStatus: readResponse.status,
        readBody: await readResponse.json(),
        writeStatus: writeResponse.status,
        writeBody: await writeResponse.json(),
        cancelStatus: cancelResponse.status,
        cancelBody: await cancelResponse.json(),
      };
    }, API_ORIGIN);

    expect(viewerBoundary.readStatus).toBe(200);
    expect(viewerBoundary.readBody).toEqual(requirementTickets);
    expect(viewerBoundary.writeStatus).toBe(403);
    expect(viewerBoundary.writeBody).toMatchObject({
      error: "forbidden",
      role: "viewer",
    });
    expect(viewerBoundary.cancelStatus).toBe(403);
    expect(viewerBoundary.cancelBody).toMatchObject({
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
    await expect(page.getByLabel("Stage Stepper")).toContainText(
      "Preflight blocked: Commit, stash, or discard local changes before running mutating workflows.",
    );
    await expect(
      page.getByRole("button", { name: /apply candidate|apply patch/i }),
    ).toHaveCount(0);
  });

  test("surfaces path-only dirty repository safety before enqueue", async ({
    page,
  }) => {
    await mockApi(page, [], {
      repositorySafetyByRequirementId: {
        "requirement-path-dirty-repo": pathOnlyDirtyRepositorySafety,
      },
      requirements: [pathOnlyDirtyRepositoryRequirement],
    });

    await page.goto("/");

    const safety = page.getByLabel("Repository Safety");
    await expect(safety).toContainText("Safety blocked");
    await expect(safety).toContainText("feature/path-only");
    await expect(safety).toContainText("HEAD def5678");
    await expect(safety).toContainText("Dirty - mutating runs blocked");
    await expect(safety).toContainText("Allowed root accepted by API");
    await expect(safety).toContainText(
      "Repository has uncommitted changes; mutating requirement runs are blocked.",
    );
    const queueItem = page
      .locator(".requirementQueueItem")
      .filter({ hasText: "Run path-only dirty repo safely" });
    await expect(queueItem).toContainText("Repository safety blocks execution");
    await expect(
      queueItem.getByRole("button", { name: "Enqueue" }),
    ).toHaveCount(0);
  });

  test("surfaces unavailable CLI agent availability before enqueue", async ({
    page,
  }) => {
    await page.addInitScript(
      ([tokenKey, roleKey]) => {
        window.localStorage.setItem(tokenKey, "operator-token");
        window.localStorage.setItem(roleKey, "operator");
      },
      [apiTokenStorageKey, apiTokenRoleStorageKey],
    );
    await mockApi(page, [], {
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
      requirements: [
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
    });

    await page.goto("/");

    const focusPanel = page.locator(".deliveryFocusPanel");
    const agentAvailability = focusPanel.getByLabel("Agent Availability");
    await expect(agentAvailability).toContainText("Unavailable agents");
    await expect(agentAvailability).toContainText("Codex CLI");
    await expect(agentAvailability).toContainText("Affected tasks: patch");
    await expect(agentAvailability).toContainText("Configure missing agent");
    await expect(agentAvailability).toContainText(
      "Codex CLI command is not configured",
    );
    await expect(page.locator(".requirementQueuePanel")).toContainText(
      "Preflight blocked",
    );
    await expect(
      page
        .locator(".requirementQueuePanel")
        .getByRole("button", { exact: true, name: "Enqueue" }),
    ).toHaveCount(0);
    await expect(page.getByLabel("Stage Stepper")).toContainText(
      "Preflight blocked: Configure missing agent",
    );
  });

  test("surfaces readable review evidence and artifact paths for requirement tickets", async ({
    page,
  }) => {
    await mockApi(page, mixedWorkflows, {
      auditEvents: [
        {
          id: "audit-requirement-enqueued",
          type: "workflow.enqueued",
          actor: "operator",
          workflowId: "workflow-needs-review",
          jobId: "job-needs-review",
          createdAt: "2026-06-06T11:06:00.000Z",
          metadata: {
            requirementId: "requirement-viewer-readable",
            status: "queued",
          },
        },
        {
          id: "audit-workflow-reviewed",
          type: "workflow.reviewed",
          actor: "operator",
          workflowId: "workflow-needs-review",
          createdAt: "2026-06-06T11:08:00.000Z",
          metadata: {
            decision: "approved",
          },
        },
        {
          id: "audit-retry-requested",
          type: "workflow.retry_requested",
          actor: "operator",
          workflowId: "workflow-needs-review",
          createdAt: "2026-06-06T11:07:00.000Z",
          metadata: {
            previousStatus: "gate_failed",
            status: "ready",
            cleanedCount: "1",
          },
        },
      ],
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
      "Review requirement evidence without mutating state.",
    );
    await expect(detail).toContainText("Viewer can read the requirement list.");
    await expect(detail).toContainText(
      "Viewer cannot create or modify requirements.",
    );
    await expect(detail).toContainText("apps/web/src/app/page.tsx");
    await expect(detail).toContainText("Automatic PR creation");
    await expect(detail).toContainText(
      "task-view Inspect evidence: agent shell; command npm run inspect:evidence; instructions Review evidence without making changes.; timeout 1m 30s; depends on task-preflight",
    );
    await expect(detail).toContainText(
      "gate-view Evidence visible: required; command npm test; timeout 2m 00s",
    );
    await expect(detail).toContainText(
      "gate-visual Visual smoke: optional; command npm run smoke:ui; timeout 3m 00s",
    );
    await expect(detail).not.toContainText(
      "Context paths pending requirement contract",
    );
    await expect(detail).not.toContainText(
      "Frozen P0 scope, local repository safety first",
    );
    await expect(detail).not.toContainText(
      "Quality-gated merge candidate evidence",
    );
    await expect(detail).not.toContainText(
      "Execution adapter selected by requirement run",
    );
    await expect(detail).not.toContainText(
      "Linked through artifacts when reported",
    );
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
    const valueReportSection = detail.locator("#requirement-detail-value-report");
    const valueReport = valueReportSection.getByLabel("Value report summary");
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
    await expect(valueReportSection).toContainText("Time spent");
    await expect(valueReportSection).toContainText("1.5s");
    await expect(valueReportSection).toContainText(
      "1 optional issue: Visual smoke failed (exit 1); does not block merge approval",
    );
    await expect(valueReport).not.toContainText("RAW_STDOUT_SHOULD_NOT_RENDER");
    await expect(detail).not.toContainText("RAW_STDOUT_SHOULD_NOT_RENDER");
    await expect(detail).not.toContainText("diff --git");
    const auditHistory = detail.getByLabel("Requirement audit history");
    await expect(auditHistory).toContainText("Audit history");
    await expect(auditHistory).toContainText("Workflow Reviewed");
    await expect(auditHistory).toContainText("Retry Requested");
    await expect(auditHistory).toContainText("Workflow Enqueued");
    await expect(auditHistory).toContainText("operator");
    await expect(auditHistory).toContainText("decision=approved");
    await expect(auditHistory).toContainText("gate_failed -> ready");
    await expect(auditHistory).not.toContainText("RAW_STDOUT_SHOULD_NOT_RENDER");
    await expect(auditHistory).not.toContainText("diff --git");
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
    await expect(detail.locator("#requirement-detail-value-report")).toContainText(
      "Required gate failed: Copy checks (exit 1); blocks merge approval",
    );
    await expect(failedValueReport).toContainText(
      "Current workflow workflow-gate-failed",
    );
    await expect(failedValueReport).not.toContainText(
      "RAW_GATE_STDOUT_SHOULD_NOT_RENDER",
    );
    const reviewAcceptance = detail.getByLabel("Review acceptance");
    await expect(reviewAcceptance).toContainText(
      "Apply unavailable until required gates pass",
    );
    await expect(reviewAcceptance).not.toContainText(
      "git apply <merge-candidate.patch>",
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

    await page.getByRole("button", { name: "New Requirement" }).click();
    const mobileFlow = page.getByRole("region", {
      name: "New Requirement panel",
    });
    await expect(mobileFlow).toBeVisible();
    await expectNoHorizontalDocumentOverflow(page);
    await expectElementsInsideViewport(page, mobileFlow);
    await expectLabelsInsideViewport(page, [
      "Gate 1 command",
      "Gate 1 requirement",
      "Gate 1 timeout",
      "Gate 2 command",
      "Gate 2 requirement",
      "Gate 2 timeout",
      "Create requirement draft",
    ]);
  });

  test("captures desktop and mobile screenshots for launch evidence", async ({
    page,
  }) => {
    const desktopScreenshotPath = join(screenshotEvidenceDir, "desktop.png");
    const mobileScreenshotPath = join(screenshotEvidenceDir, "mobile.png");
    await resetScreenshotEvidence([
      desktopScreenshotPath,
      mobileScreenshotPath,
    ]);
    await mockApi(page, mobileStressWorkflows);

    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: "Requirement Delivery Console" }),
    ).toBeVisible();
    await captureScreenshotEvidence(page, desktopScreenshotPath);
    await expectScreenshotEvidence(desktopScreenshotPath);

    await page.setViewportSize({ width: 390, height: 900 });
    await expectNoHorizontalDocumentOverflow(page);
    await captureScreenshotEvidence(page, mobileScreenshotPath);
    await expectScreenshotEvidence(mobileScreenshotPath);
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
    await expect(flow).toContainText(
      "Local real repository path or registered repository ID",
    );
    await expect(flow).toContainText(
      "Safety preflight checks branch, HEAD, clean/dirty state, and allowed root before mutating runs",
    );
    await expect(flow).toContainText(
      "No MAWO auto-merge; merge candidate stays manual git apply outside MAWO",
    );

    await fillField(flow, /title|requirement title/i, "Smoke gated checkout");
    await fillField(flow, /repository path/i, "C:/work/shop");
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
    await fillField(
      flow,
      /task 1 objective/i,
      "Patch checkout copy without changing payment behavior.",
    );
    await fillField(
      flow,
      /task 1 acceptance/i,
      "Checkout copy is updated.\nPayment behavior stays unchanged.",
    );
    await fillField(flow, /task 1 command/i, "npm run patch:checkout");
    await fillField(flow, /task 1 timeout/i, "90000");
    await fillField(flow, /task 2 title/i, "Review checkout evidence.");
    await fillField(
      flow,
      /task 2 objective/i,
      "Inspect the generated patch before approval.",
    );
    await fillField(
      flow,
      /task 2 acceptance/i,
      "Patch artifact is reviewable.",
    );
    await chooseTaskAgent(flow, /task 2 agent/i, "codex");
    await fillField(flow, /task 2 instructions/i, "Review the generated patch.");
    await fillField(flow, /task 2 depends/i, "task-1");
    await fillField(flow, /gate 1 command/i, "npm test");
    await fillField(flow, /gate 1 timeout/i, "120000");
    await chooseGateRequired(flow, /gate 2 requirement/i, "optional");
    await fillField(flow, /gate 2 command/i, "npm run smoke:ui");
    await fillField(flow, /gate 2 timeout/i, "180000");
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
          objective: "Patch checkout copy without changing payment behavior.",
          acceptanceCriteria: [
            "Checkout copy is updated.",
            "Payment behavior stays unchanged.",
          ],
          agent: "shell",
          command: "npm run patch:checkout",
          timeoutMs: 90000,
        }),
        expect.objectContaining({
          id: "task-2",
          title: "Review checkout evidence.",
          objective: "Inspect the generated patch before approval.",
          acceptanceCriteria: ["Patch artifact is reviewable."],
          agent: "codex",
          instructions: "Review the generated patch.",
          dependsOn: ["task-1"],
        }),
      ]),
      qualityGates: expect.arrayContaining([
        expect.objectContaining({
          command: "npm test",
          required: true,
          timeoutMs: 120000,
        }),
        expect.objectContaining({
          command: "npm run smoke:ui",
          required: false,
          timeoutMs: 180000,
        }),
      ]),
    });
  });

  test("New Requirement creation refreshes and focuses the created requirement workspace", async ({
    page,
  }) => {
    const existingRequirement: RequirementDeliveryTicket = {
      id: "requirement-existing",
      title: "Existing review item",
      repositoryPath: "C:/work/existing",
      goal: "Keep the previous item available.",
      acceptanceCriteria: ["Existing item stays in the queue."],
      constraints: ["No MAWO auto-merge; manual git apply outside MAWO"],
      nonGoals: ["Automatic PR creation"],
      riskLevel: "medium",
      contextPaths: [],
      tasks: [
        {
          id: "task-existing",
          title: "Inspect existing evidence",
          agent: "shell",
          instructions: "Inspect evidence.",
        },
      ],
      qualityGates: [
        {
          id: "gate-existing",
          title: "Unit tests",
          command: "npm test",
          required: true,
        },
      ],
      status: "running",
      runLinks: [],
      createdAt: "2026-06-06T10:20:00.000Z",
      updatedAt: "2026-06-06T10:25:00.000Z",
    };
    const requirements: RequirementDeliveryTicket[] = [existingRequirement];
    const createdRequests: unknown[] = [];

    await page.addInitScript(
      ([tokenKey, roleKey]) => {
        window.localStorage.setItem(tokenKey, "operator-token");
        window.localStorage.setItem(roleKey, "operator");
      },
      [apiTokenStorageKey, apiTokenRoleStorageKey],
    );
    await mockApi(page, mixedWorkflows, {
      mergeCandidates: {
        "requirement-existing": requirementMergeCandidate,
      },
      reports: {
        "requirement-existing": requirementEvidenceReport,
      },
      repositorySafetyByRepositoryId: {
        "repo-created": {
          repositoryId: "repo-created",
          path: "C:/work/created",
          defaultBranch: "main",
          currentBranch: "feature/new-requirement",
          headShortSha: "def5678",
          clean: true,
          dirty: false,
          allowedRoot: true,
          noAutoMerge: true,
          manualApplyPolicy:
            "Manual review is required; MAWO never automatically merges repository changes.",
        },
      },
      requirements,
      onRequirementCreate: (payload) => {
        createdRequests.push(payload);
        const createdRequirement: RequirementDeliveryTicket = {
          id: "requirement-created",
          title: "Created checkout requirement",
          repositoryId: "repo-created",
          goal: "Refresh the requirement workspace after creation.",
          acceptanceCriteria: [
            "Created ticket appears in the requirement queue.",
            "Decision queue shows plan confirmation.",
          ],
          constraints: ["No MAWO auto-merge; manual git apply outside MAWO"],
          nonGoals: ["Automatic PR creation"],
          riskLevel: "high",
          contextPaths: ["apps/web/src/app/page.tsx"],
          tasks: [
            {
              id: "task-1",
              title: "Patch checkout copy",
              agent: "shell",
              command: "npm run patch:checkout",
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
          status: "plan_review",
          runLinks: [],
          createdAt: "2026-06-06T11:20:00.000Z",
          updatedAt: "2026-06-06T11:20:00.000Z",
        };

        requirements.push(createdRequirement);
        return createdRequirement;
      },
    });

    await page.goto("/");
    await expect(
      page.locator(".deliveryFocusPanel").getByRole("heading", {
        name: "Existing review item",
      }),
    ).toBeVisible();

    await page.getByRole("button", { name: "New Requirement" }).click();
    const flow = page.getByRole("region", {
      name: "New Requirement panel",
    });
    await fillField(flow, /title|requirement title/i, "Created checkout requirement");
    await fillField(flow, /repository id/i, "repo-created");
    await fillField(
      flow,
      /goal/i,
      "Refresh the requirement workspace after creation.",
    );
    await fillField(
      flow,
      /acceptance criteria/i,
      "Created ticket appears in the requirement queue.\nDecision queue shows plan confirmation.",
    );
    await fillField(flow, /constraints/i, "No MAWO auto-merge.");
    await fillField(flow, /non-?goals/i, "Automatic PR creation.");
    await fillField(flow, /context paths/i, "apps/web/src/app/page.tsx");
    await fillField(flow, /task 1 title/i, "Patch checkout copy");
    await fillField(
      flow,
      /task 1 objective/i,
      "Create a focused checkout copy patch.",
    );
    await fillField(
      flow,
      /task 1 acceptance/i,
      "Checkout copy patch is ready for review.",
    );
    await fillField(flow, /task 1 command/i, "npm run patch:checkout");
    await fillField(flow, /gate 1 command/i, "npm test");
    await chooseRisk(flow, "high");

    await flow
      .getByRole("button", {
        name: /create requirement|save requirement|create/i,
      })
      .click();

    await expect
      .poll(() => createdRequests.length, {
        message: "wait for created requirement request",
      })
      .toBe(1);

    const queue = page.locator(".requirementQueuePanel");
    const createdQueueItem = queue
      .locator(".requirementQueueItem")
      .filter({ hasText: "Created checkout requirement" });
    await expect(queue).toContainText("2 active");
    await expect(createdQueueItem).toContainText("Plan review");
    await expect(createdQueueItem).toContainText("Confirm plan");

    const focusPanel = page.locator(".deliveryFocusPanel");
    await expect(
      focusPanel.getByRole("heading", {
        name: "Created checkout requirement",
      }),
    ).toBeVisible();
    await expect(page.getByLabel("Stage Stepper")).toContainText("Plan");
    await expect(page.locator(".decisionQueuePanel")).toContainText("1 waiting");
    await expect(page.locator(".decisionQueuePanel")).toContainText(
      "Confirm plan",
    );
    await expect(focusPanel.getByLabel("Repository Safety")).toContainText(
      "feature/new-requirement",
    );
    await expect(focusPanel.getByLabel("Repository Safety")).toContainText(
      "HEAD def5678",
    );
    await expect(focusPanel.getByLabel("Repository Safety")).toContainText(
      "Clean - mutating runs allowed",
    );
    await expect(focusPanel.getByLabel("Repository Safety")).toContainText(
      "Allowed root accepted by API",
    );
    await expect(focusPanel.getByLabel("Repository Safety")).toContainText(
      "No MAWO auto-merge; manual git apply outside MAWO",
    );
    await expect(focusPanel.getByLabel("Gate Result / Review Evidence")).toContainText(
      "Not review-ready",
    );
    await expect(focusPanel).not.toContainText("Apply Candidate");

    await page.locator(".requirementDetailDisclosure > summary").click();
    await expect(page.locator(".requirementDetailShell")).toContainText(
      "No artifacts linked yet",
    );
    await expect(flow).toBeHidden();

    await queue
      .getByRole("button", {
        name: "Select requirement Existing review item",
      })
      .click();
    await expect(
      focusPanel.getByRole("heading", {
        level: 2,
        name: "Existing review item",
      }),
    ).toBeVisible();
  });

  test("new requirement can continue into review-ready evidence in one focused journey", async ({
    page,
  }) => {
    const workflows: WorkflowRun[] = [];
    const requirements: RequirementDeliveryTicket[] = [];
    const reports: Record<string, unknown> = {};
    const mergeCandidates: Record<string, unknown> = {};
    const actions: string[] = [];
    let jobPolls = 0;

    await page.addInitScript(
      ([tokenKey, roleKey]) => {
        window.localStorage.setItem(tokenKey, "operator-token");
        window.localStorage.setItem(roleKey, "operator");
      },
      [apiTokenStorageKey, apiTokenRoleStorageKey],
    );
    await mockApi(page, workflows, {
      mergeCandidates,
      reports,
      repositorySafetyByRepositoryId: {
        "repo-journey": {
          repositoryId: "repo-journey",
          path: "C:/work/journey",
          defaultBranch: "main",
          currentBranch: "feature/checkout-journey",
          headShortSha: "fed9876",
          clean: true,
          dirty: false,
          allowedRoot: true,
          noAutoMerge: true,
          manualApplyPolicy:
            "Manual review is required; MAWO never automatically merges repository changes.",
        },
      },
      requirements,
      onRequirementCreate: () => {
        const createdRequirement: RequirementDeliveryTicket = {
          id: "requirement-created-journey",
          title: "Journey checkout requirement",
          repositoryId: "repo-journey",
          goal: "Run the created requirement through review-ready evidence.",
          acceptanceCriteria: [
            "Operator confirms the plan.",
            "Queued job refreshes into review evidence.",
          ],
          constraints: ["No MAWO auto-merge; manual git apply outside MAWO"],
          nonGoals: ["Automatic PR creation"],
          riskLevel: "medium",
          contextPaths: ["apps/web/src/app/page.tsx"],
          tasks: [
            {
              id: "task-journey",
              title: "Patch checkout copy",
              agent: "shell",
              command: "npm run patch:checkout",
            },
          ],
          qualityGates: [
            {
              id: "gate-journey",
              title: "Unit tests",
              command: "npm test",
              required: true,
            },
          ],
          status: "plan_review",
          runLinks: [],
          createdAt: "2026-06-06T12:00:00.000Z",
          updatedAt: "2026-06-06T12:00:00.000Z",
        };

        requirements.push(createdRequirement);
        return createdRequirement;
      },
      onRequirementAction: ({ action, id }) => {
        actions.push(`${action}:${id}`);

        if (id === "requirement-created-journey" && action === "confirm-plan") {
          return updateRequirement(requirements, id, {
            status: "ready_to_run",
            updatedAt: "2026-06-06T12:01:00.000Z",
          });
        }

        if (id === "requirement-created-journey" && action === "enqueue") {
          const workflow: WorkflowRun = {
            ...baseWorkflow,
            id: "workflow-created-journey",
            goal: "Journey checkout requirement",
            repositoryPath: "C:/work/journey",
            status: "ready",
            createdAt: "2026-06-06T12:02:00.000Z",
            updatedAt: "2026-06-06T12:02:00.000Z",
          };
          workflows.push(workflow);

          return {
            requirement: updateRequirement(requirements, id, {
              status: "running",
              currentWorkflowRunId: "workflow-created-journey",
              runLinks: [
                {
                  workflowRunId: "workflow-created-journey",
                  status: "ready",
                  linkedAt: "2026-06-06T12:02:00.000Z",
                },
              ],
              updatedAt: "2026-06-06T12:02:00.000Z",
            }),
            workflow,
            job: {
              id: "job-created-journey",
              workflowId: "workflow-created-journey",
              status: "queued",
              createdAt: "2026-06-06T12:02:00.000Z",
              updatedAt: "2026-06-06T12:02:00.000Z",
            },
          };
        }

        throw new Error(`Unexpected requirement action ${action}:${id}`);
      },
      onJobRequest: ({ id }) => {
        if (id !== "job-created-journey") {
          throw new Error(`Unexpected job poll ${id}`);
        }

        jobPolls += 1;

        if (jobPolls < 2) {
          return {
            id,
            workflowId: "workflow-created-journey",
            status: "running",
            createdAt: "2026-06-06T12:02:00.000Z",
            updatedAt: "2026-06-06T12:02:01.000Z",
          };
        }

        workflows[0] = {
          ...workflows[0]!,
          status: "needs_review",
          updatedAt: "2026-06-06T12:03:00.000Z",
        };
        updateRequirement(requirements, "requirement-created-journey", {
          status: "needs_review",
          currentWorkflowRunId: "workflow-created-journey",
          runLinks: [
            {
              workflowRunId: "workflow-created-journey",
              status: "needs_review",
              linkedAt: "2026-06-06T12:03:00.000Z",
            },
          ],
          updatedAt: "2026-06-06T12:03:00.000Z",
        });
        reports["requirement-created-journey"] = {
          ...requirementEvidenceReport,
          workflowId: "workflow-created-journey",
          reportArtifactPath:
            "C:/mawo/artifacts/workflow-created-journey/report.json",
          summary: "Journey task passed; required gate passed",
        };
        mergeCandidates["requirement-created-journey"] = {
          ...requirementMergeCandidate,
          workflowId: "workflow-created-journey",
          summary: "Journey merge candidate ready with 2 changed files",
          sourceBranches: ["mawo/workflow-created-journey/task-journey"],
          patchArtifactPath:
            "C:/mawo/artifacts/workflow-created-journey/merge-candidate.patch",
          manifestArtifactPath:
            "C:/mawo/artifacts/workflow-created-journey/merge-candidate.json",
          applyCommand:
            'git -C "C:/work/journey" apply "C:/mawo/artifacts/workflow-created-journey/merge-candidate.patch"',
          createdAt: "2026-06-06T12:03:00.000Z",
        };

        return {
          id,
          workflowId: "workflow-created-journey",
          status: "completed",
          createdAt: "2026-06-06T12:02:00.000Z",
          updatedAt: "2026-06-06T12:03:00.000Z",
          finishedAt: "2026-06-06T12:03:00.000Z",
        };
      },
    });

    await page.goto("/");
    await page.getByRole("button", { name: "New Requirement" }).click();

    const flow = page.getByRole("region", {
      name: "New Requirement panel",
    });
    await fillField(flow, /title|requirement title/i, "Journey checkout requirement");
    await fillField(flow, /repository id/i, "repo-journey");
    await fillField(
      flow,
      /goal/i,
      "Run the created requirement through review-ready evidence.",
    );
    await fillField(
      flow,
      /acceptance criteria/i,
      "Operator confirms the plan.\nQueued job refreshes into review evidence.",
    );
    await fillField(flow, /constraints/i, "No MAWO auto-merge.");
    await fillField(flow, /non-?goals/i, "Automatic PR creation.");
    await fillField(flow, /context paths/i, "apps/web/src/app/page.tsx");
    await fillField(flow, /task 1 title/i, "Patch checkout copy");
    await fillField(
      flow,
      /task 1 objective/i,
      "Create a focused checkout copy patch.",
    );
    await fillField(
      flow,
      /task 1 acceptance/i,
      "Checkout copy patch is ready for review.",
    );
    await fillField(flow, /task 1 command/i, "npm run patch:checkout");
    await fillField(flow, /gate 1 command/i, "npm test");

    await flow
      .getByRole("button", {
        name: /create requirement|save requirement|create/i,
      })
      .click();

    const queueItem = page
      .locator(".requirementQueueItem")
      .filter({ hasText: "Journey checkout requirement" });
    const focusPanel = page.locator(".deliveryFocusPanel");
    await expect(queueItem).toContainText("Plan review");
    await expect(
      focusPanel.getByRole("heading", {
        name: "Journey checkout requirement",
      }),
    ).toBeVisible();

    await queueItem
      .getByRole("button", { exact: true, name: "Confirm plan" })
      .click();
    await expect(queueItem).toContainText("Ready to run");
    await expect(page.getByLabel("Stage Stepper")).toContainText("Run");

    await queueItem
      .getByRole("button", { exact: true, name: "Enqueue" })
      .click();
    await expect(queueItem).toContainText("Running");
    await expect(queueItem).toContainText("Queued");
    await expect
      .poll(() => jobPolls, {
        message: "wait for the created requirement job to poll",
      })
      .toBeGreaterThan(0);

    await expect(queueItem).toContainText("Needs review");
    await expect(queueItem).toContainText("Review merge candidate");
    await expect(page.getByLabel("Workflow sync")).toContainText(
      "Requirement execution settled; evidence refreshed: Journey checkout requirement",
    );
    await expect(page.getByLabel("Stage Stepper")).toContainText("Review");
    await expect(focusPanel.getByLabel("Gate Result / Review Evidence")).toContainText(
      "Review-ready merge candidate",
    );
    await expect(focusPanel.getByLabel("Gate Result / Review Evidence")).toContainText(
      "Journey merge candidate ready with 2 changed files",
    );
    await expect(focusPanel.getByLabel("Gate Result / Review Evidence")).toContainText(
      'git -C "C:/work/journey" apply "C:/mawo/artifacts/workflow-created-journey/merge-candidate.patch"',
    );
    await expect(focusPanel).not.toContainText("Apply Candidate");
    expect(actions).toEqual([
      "confirm-plan:requirement-created-journey",
      "enqueue:requirement-created-journey",
    ]);
  });

  test("retry supersedes stale gate evidence before fresh review evidence", async ({
    page,
  }) => {
    const workflows: WorkflowRun[] = [lifecycleFailedWorkflow];
    const requirements: RequirementDeliveryTicket[] = [lifecycleRetryRequirement];
    const reports: Record<string, unknown> = {
      "requirement-retry": {
        ...gateFailedEvidenceReport,
        workflowId: "workflow-failed",
      },
    };
    const mergeCandidates: Record<string, unknown> = {};
    let jobPolls = 0;

    await page.addInitScript(
      ([tokenKey, roleKey]) => {
        window.localStorage.setItem(tokenKey, "operator-token");
        window.localStorage.setItem(roleKey, "operator");
      },
      [apiTokenStorageKey, apiTokenRoleStorageKey],
    );
    await mockApi(page, workflows, {
      mergeCandidates,
      reports,
      requirements,
      onRequirementAction: ({ action, id }) => {
        if (id !== "requirement-retry") {
          throw new Error(`Unexpected requirement ${id}`);
        }

        if (action === "retry") {
          const freshWorkflow: WorkflowRun = {
            ...lifecycleFailedWorkflow,
            id: "workflow-retry-fresh",
            status: "ready",
            createdAt: "2026-06-06T12:10:00.000Z",
            updatedAt: "2026-06-06T12:10:00.000Z",
            qualityGates: lifecycleFailedWorkflow.qualityGates.map((gate) => ({
              ...gate,
              status: "waiting",
              result: undefined,
            })),
          };
          workflows.push(freshWorkflow);
          delete reports["requirement-retry"];

          return {
            requirement: updateRequirement(requirements, id, {
              status: "ready_to_run",
              currentWorkflowRunId: "workflow-retry-fresh",
              runLinks: [
                {
                  workflowRunId: "workflow-failed",
                  status: "gate_failed",
                  linkedAt: "2026-06-06T10:58:00.000Z",
                },
                {
                  workflowRunId: "workflow-retry-fresh",
                  status: "ready",
                  linkedAt: "2026-06-06T12:10:00.000Z",
                },
              ],
              updatedAt: "2026-06-06T12:10:00.000Z",
            }),
            retry: {
              previousStatus: "gate_failed",
              status: "ready",
            },
            workflow: freshWorkflow,
          };
        }

        if (action === "enqueue") {
          workflows[1] = {
            ...workflows[1]!,
            status: "ready",
            updatedAt: "2026-06-06T12:11:00.000Z",
          };

          return {
            requirement: updateRequirement(requirements, id, {
              status: "running",
              currentWorkflowRunId: "workflow-retry-fresh",
              runLinks: [
                {
                  workflowRunId: "workflow-failed",
                  status: "gate_failed",
                  linkedAt: "2026-06-06T10:58:00.000Z",
                },
                {
                  workflowRunId: "workflow-retry-fresh",
                  status: "ready",
                  linkedAt: "2026-06-06T12:11:00.000Z",
                },
              ],
              updatedAt: "2026-06-06T12:11:00.000Z",
            }),
            workflow: workflows[1],
            job: {
              id: "job-retry-fresh",
              workflowId: "workflow-retry-fresh",
              status: "queued",
              createdAt: "2026-06-06T12:11:00.000Z",
              updatedAt: "2026-06-06T12:11:00.000Z",
            },
          };
        }

        throw new Error(`Unexpected requirement action ${action}:${id}`);
      },
      onJobRequest: ({ id }) => {
        if (id !== "job-retry-fresh") {
          throw new Error(`Unexpected job poll ${id}`);
        }

        jobPolls += 1;

        if (jobPolls < 2) {
          return {
            id,
            workflowId: "workflow-retry-fresh",
            status: "running",
            createdAt: "2026-06-06T12:11:00.000Z",
            updatedAt: "2026-06-06T12:11:01.000Z",
          };
        }

        workflows[1] = {
          ...workflows[1]!,
          status: "needs_review",
          updatedAt: "2026-06-06T12:12:00.000Z",
        };
        updateRequirement(requirements, "requirement-retry", {
          status: "needs_review",
          currentWorkflowRunId: "workflow-retry-fresh",
          runLinks: [
            {
              workflowRunId: "workflow-failed",
              status: "gate_failed",
              linkedAt: "2026-06-06T10:58:00.000Z",
            },
            {
              workflowRunId: "workflow-retry-fresh",
              status: "needs_review",
              linkedAt: "2026-06-06T12:12:00.000Z",
            },
          ],
          updatedAt: "2026-06-06T12:12:00.000Z",
        });
        reports["requirement-retry"] = {
          ...requirementEvidenceReport,
          workflowId: "workflow-retry-fresh",
          reportArtifactPath:
            "C:/mawo/artifacts/workflow-retry-fresh/report.json",
          summary: "Fresh retry task passed; required gate passed",
        };
        mergeCandidates["requirement-retry"] = {
          ...requirementMergeCandidate,
          workflowId: "workflow-retry-fresh",
          summary: "Fresh retry merge candidate ready",
          sourceBranches: ["mawo/workflow-retry-fresh/task-retry"],
          patchArtifactPath:
            "C:/mawo/artifacts/workflow-retry-fresh/merge-candidate.patch",
          manifestArtifactPath:
            "C:/mawo/artifacts/workflow-retry-fresh/merge-candidate.json",
          applyCommand:
            'git -C "C:/work/shop" apply "C:/mawo/artifacts/workflow-retry-fresh/merge-candidate.patch"',
          createdAt: "2026-06-06T12:12:00.000Z",
        };

        return {
          id,
          workflowId: "workflow-retry-fresh",
          status: "completed",
          createdAt: "2026-06-06T12:11:00.000Z",
          updatedAt: "2026-06-06T12:12:00.000Z",
          finishedAt: "2026-06-06T12:12:00.000Z",
        };
      },
    });

    await page.goto("/");

    const queueItem = page
      .locator(".requirementQueueItem")
      .filter({ hasText: "Retry stale gate" });
    const focusPanel = page.locator(".deliveryFocusPanel");
    await expect(queueItem).toContainText("Needs rework");
    await expect(focusPanel.getByLabel("Gate Result / Review Evidence")).toContainText(
      "Gate blocked by required gate",
    );
    await expect(focusPanel.getByLabel("Gate Result / Review Evidence")).toContainText(
      "Copy checks failed (exit 1)",
    );

    await queueItem.getByRole("button", { exact: true, name: "Retry" }).click();
    await expect(page.getByLabel("Workflow sync")).toContainText(
      "Retry reset to ready. Enqueue to run fresh evidence. Stale execution evidence is superseded.",
    );
    await expect(queueItem).toContainText("Ready to run");
    await expect(queueItem).toContainText("workflow-retry-fresh");
    await expect(focusPanel.getByLabel("Gate Result / Review Evidence")).toContainText(
      "Not review-ready",
    );
    await expect(focusPanel.getByLabel("Gate Result / Review Evidence")).not.toContainText(
      "Gate blocked by required gate",
    );
    await expect(focusPanel.getByLabel("Gate Result / Review Evidence")).not.toContainText(
      "Copy checks failed (exit 1)",
    );

    await queueItem.getByRole("button", { exact: true, name: "Enqueue" }).click();
    await expect(queueItem).toContainText("Running");
    await expect(queueItem).toContainText("Queued");
    await expect
      .poll(() => jobPolls, {
        message: "wait for fresh retry job to poll",
      })
      .toBeGreaterThan(0);

    await expect(queueItem).toContainText("Needs review");
    await expect(focusPanel.getByLabel("Gate Result / Review Evidence")).toContainText(
      "Review-ready merge candidate",
    );
    await expect(focusPanel.getByLabel("Gate Result / Review Evidence")).toContainText(
      "Fresh retry merge candidate ready",
    );
    await expect(focusPanel.getByLabel("Gate Result / Review Evidence")).toContainText(
      "Current workflow workflow-retry-fresh",
    );
    await expect(focusPanel.getByLabel("Gate Result / Review Evidence")).not.toContainText(
      "workflow-failed",
    );
    await expect(focusPanel.getByLabel("Gate Result / Review Evidence")).not.toContainText(
      "Gate blocked by required gate",
    );
    await expect(focusPanel).not.toContainText("Apply Candidate");
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

  test("operator can cancel an active requirement job without stale running evidence", async ({
    page,
  }) => {
    const workflows: WorkflowRun[] = [];
    const requirements: RequirementDeliveryTicket[] = [
      {
        ...lifecyclePlanRequirement,
        id: "requirement-cancel",
        title: "Cancel active checkout evidence",
        status: "ready_to_run",
        updatedAt: "2026-06-06T12:20:00.000Z",
      },
    ];
    const canceledJobs: string[] = [];
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
        if (id !== "requirement-cancel" || action !== "enqueue") {
          throw new Error(`Unexpected action ${action}:${id}`);
        }

        workflows.push({
          ...lifecycleQueuedWorkflow,
          id: "workflow-cancel",
          goal: "Cancel active checkout evidence",
          status: "ready",
          updatedAt: "2026-06-06T12:21:00.000Z",
        });

        return {
          requirement: updateRequirement(requirements, id, {
            status: "running",
            currentWorkflowRunId: "workflow-cancel",
            runLinks: [
              {
                workflowRunId: "workflow-cancel",
                status: "ready",
                linkedAt: "2026-06-06T12:21:00.000Z",
              },
            ],
            updatedAt: "2026-06-06T12:21:00.000Z",
          }),
          workflow: workflows[0],
          job: {
            id: "job-cancel",
            workflowId: "workflow-cancel",
            status: "queued",
            createdAt: "2026-06-06T12:21:00.000Z",
            updatedAt: "2026-06-06T12:21:00.000Z",
          },
        };
      },
      onJobCancel: ({ id }) => {
        if (id !== "job-cancel") {
          throw new Error(`Unexpected job cancel ${id}`);
        }

        canceledJobs.push(id);
        workflows[0] = {
          ...workflows[0]!,
          status: "ready",
          updatedAt: "2026-06-06T12:22:00.000Z",
        };
        updateRequirement(requirements, "requirement-cancel", {
          status: "ready_to_run",
          currentWorkflowRunId: "workflow-cancel",
          runLinks: [
            {
              workflowRunId: "workflow-cancel",
              status: "ready",
              linkedAt: "2026-06-06T12:22:00.000Z",
            },
          ],
          updatedAt: "2026-06-06T12:22:00.000Z",
        });

        return {
          id,
          workflowId: "workflow-cancel",
          status: "canceled",
          createdAt: "2026-06-06T12:21:00.000Z",
          updatedAt: "2026-06-06T12:22:00.000Z",
          finishedAt: "2026-06-06T12:22:00.000Z",
        };
      },
      onJobRequest: ({ id }) => {
        if (id !== "job-cancel") {
          throw new Error(`Unexpected job poll ${id}`);
        }

        jobPolls += 1;
        return {
          id,
          workflowId: "workflow-cancel",
          status: "running",
          createdAt: "2026-06-06T12:21:00.000Z",
          updatedAt: "2026-06-06T12:21:01.000Z",
        };
      },
    });

    await page.goto("/");

    const queueItem = page
      .locator(".requirementQueueItem")
      .filter({ hasText: "Cancel active checkout evidence" });
    const focusPanel = page.locator(".deliveryFocusPanel");
    await expect(queueItem).toContainText("Ready to run");

    await queueItem.getByRole("button", { exact: true, name: "Enqueue" }).click();
    await expect(queueItem).toContainText("Running");
    await expect(queueItem).toContainText("Queued");
    await expect(queueItem.getByRole("button", { exact: true, name: "Cancel" })).toBeVisible();

    await queueItem.getByRole("button", { exact: true, name: "Cancel" }).click();
    await expect
      .poll(() => canceledJobs, {
        message: "wait for job cancel request",
      })
      .toEqual(["job-cancel"]);
    await expect(page.getByLabel("Workflow sync")).toContainText(
      "Requirement job canceled: Cancel active checkout evidence. Enqueue to run fresh evidence.",
    );
    await expect(queueItem.getByRole("status")).toContainText(
      "Requirement job canceled: Cancel active checkout evidence. Enqueue to run fresh evidence.",
    );
    await expect(queueItem.getByRole("status")).not.toContainText("Run again");
    await expect(queueItem).toContainText("Ready to run");
    await expect(queueItem).toContainText("Canceled");
    await expect(queueItem).toContainText("Enqueue");
    await expect(queueItem).not.toContainText("Queued");
    await expect(queueItem).not.toContainText("Running");
    await expect(focusPanel.getByLabel("Gate Result / Review Evidence")).toContainText(
      "Not review-ready",
    );
    await expect(focusPanel.getByLabel("Gate Result / Review Evidence")).not.toContainText(
      "Review-ready merge candidate",
    );

    const pollsAfterCancel = jobPolls;
    await page.waitForTimeout(1800);
    expect(jobPolls).toBe(pollsAfterCancel);
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
    onRequirementCreate?: (payload: unknown) => unknown;
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
    onJobCancel?: (request: { id: string }) => WorkflowJob | unknown;
    onJobRequest?: (request: { id: string }) => WorkflowJob | unknown;
    launchGateEvidence?: LaunchGateEvidence;
    auditEvents?: AuditEvent[];
    mergeCandidates?: Record<string, unknown>;
    reports?: Record<string, unknown>;
    repositorySafetyByRequirementId?: Record<string, RepositorySafety>;
    repositorySafetyByRepositoryId?: Record<string, RepositorySafety>;
    requirements?: RequirementDeliveryTicket[];
    agentHealth?: AgentHealth[];
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

    if (request.method() === "GET" && url.pathname === "/agents/health") {
      await route.fulfill({ json: options.agentHealth ?? [] });
      return;
    }

    if (request.method() === "GET" && url.pathname === "/audit-events") {
      const requirementId = url.searchParams.get("requirementId");
      const workflowId = url.searchParams.get("workflowId");
      const auditEvents = options.auditEvents ?? [];

      await route.fulfill({
        json: auditEvents.filter((event) => {
          if (
            requirementId &&
            event.metadata?.requirementId !== requirementId
          ) {
            return false;
          }

          if (workflowId && event.workflowId !== workflowId) {
            return false;
          }

          return true;
        }),
      });
      return;
    }

    if (
      request.method() === "GET" &&
      url.pathname === "/launch/evidence/latest"
    ) {
      await route.fulfill(
        options.launchGateEvidence
          ? { json: options.launchGateEvidence }
          : { status: 404, json: { error: "launch_gate_evidence_not_found" } },
      );
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

    const jobCancelMatch = url.pathname.match(/^\/jobs\/([^/]+)\/cancel$/);
    if (request.method() === "POST" && jobCancelMatch) {
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

      const id = decodeURIComponent(jobCancelMatch[1] ?? "");
      const job = options.onJobCancel?.({ id }) ?? {
        id,
        workflowId: "",
        status: "canceled",
        createdAt: "2026-06-06T12:00:00.000Z",
        updatedAt: "2026-06-06T12:00:00.000Z",
        finishedAt: "2026-06-06T12:00:00.000Z",
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

    const requirementSafetyMatch = url.pathname.match(
      /^\/requirements\/([^/]+)\/safety$/,
    );
    if (request.method() === "GET" && requirementSafetyMatch) {
      const requirementId = decodeURIComponent(
        requirementSafetyMatch[1] ?? "",
      );
      const safety = options.repositorySafetyByRequirementId?.[requirementId];

      await route.fulfill(
        safety
          ? { json: safety }
          : { status: 404, json: { error: "requirement_safety_not_found" } },
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
      const created = options.onRequirementCreate?.(payload);
      await route.fulfill({
        status: 201,
        json:
          created ??
          {
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

async function chooseGateRequired(scope: Locator, label: RegExp, value: string) {
  const gateRequirement = scope.getByLabel(label).first();
  await expect(gateRequirement).toBeVisible();
  await gateRequirement.selectOption(value);
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

async function resetScreenshotEvidence(paths: string[]) {
  await mkdir(screenshotEvidenceDir, { recursive: true });
  await Promise.all(paths.map((path) => rm(path, { force: true })));
}

async function captureScreenshotEvidence(page: Page, path: string) {
  await mkdir(dirname(path), { recursive: true });
  await page.screenshot({ fullPage: true, path });
}

async function expectScreenshotEvidence(path: string) {
  const evidence = await stat(path);
  expect(evidence.size).toBeGreaterThan(10_000);
  expect(dirname(path)).toBe(screenshotEvidenceDir);
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

const pathOnlyDirtyRepositoryRequirement: RequirementDeliveryTicket = {
  id: "requirement-path-dirty-repo",
  title: "Run path-only dirty repo safely",
  repositoryPath: "C:/work/path-only-shop",
  goal: "Block mutating runs until path-only repository safety is clear.",
  acceptanceCriteria: ["Dirty repository state is visible before enqueue."],
  constraints: ["No MAWO auto-merge; manual git apply outside MAWO"],
  nonGoals: ["Automatic PR creation"],
  riskLevel: "high",
  contextPaths: ["apps/web/src/app/page.tsx"],
  tasks: [
    {
      id: "task-path-dirty",
      title: "Patch checkout",
      agent: "shell",
      instructions: "Patch checkout after the repository is clean.",
    },
  ],
  qualityGates: [
    {
      id: "gate-path-dirty",
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

const pathOnlyDirtyRepositorySafety: RepositorySafety = {
  ...dirtyRepositorySafety,
  repositoryId: "requirement-path-dirty-repo",
  path: "C:/work/path-only-shop",
  currentBranch: "feature/path-only",
  headShortSha: "def5678",
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
        command: "npm run inspect:evidence",
        instructions: "Review evidence without making changes.",
        timeoutMs: 90000,
        dependsOn: ["task-preflight"],
      },
    ],
    qualityGates: [
      {
        id: "gate-view",
        title: "Evidence visible",
        command: "npm test",
        required: true,
        timeoutMs: 120000,
      },
      {
        id: "gate-visual",
        title: "Visual smoke",
        command: "npm run smoke:ui",
        required: false,
        timeoutMs: 180000,
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
      durationMs: 1200,
    },
  ],
  gateResults: [
    {
      id: "gate-view",
      title: "Evidence visible",
      status: "passed",
      stdoutArtifactPath:
        "C:/mawo/artifacts/workflow-needs-review/gates/gate-view/stdout.txt",
      durationMs: 300,
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
