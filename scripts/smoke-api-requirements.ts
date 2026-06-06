import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../apps/api/src/server.js";

type JsonObject = Record<string, unknown>;

const operatorToken = "operator-requirements-smoke-token";
const viewerToken = "viewer-requirements-smoke-token";

function log(message: string) {
  console.log(`[smoke:api:requirements] ${message}`);
}

async function request(
  app: ReturnType<typeof buildApp>,
  method: string,
  path: string,
  payload?: JsonObject,
  token = operatorToken,
) {
  const response = await app.inject({
    method,
    url: path,
    headers: {
      authorization: `Bearer ${token}`,
      ...(payload ? { "content-type": "application/json" } : {}),
    },
    payload,
  });
  const text = response.body;
  const body = text ? (JSON.parse(text) as unknown) : undefined;

  return {
    status: response.statusCode,
    body,
  };
}

function check(failures: string[], condition: unknown, message: string): void {
  if (!condition) {
    failures.push(message);
  }
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function createRequirementPayload(): JsonObject {
  return {
    title: "Smoke requirement: gated checkout copy",
    repositoryPath: "C:/work/mawo-smoke-repo",
    goal: "Produce an isolated, quality-gated patch with auditable review evidence.",
    acceptanceCriteria: [
      "Changed files are summarized for review.",
      "Required gates block merge-ready conclusions when they fail.",
      "The merge candidate is manual-apply only.",
    ],
    constraints: [
      "Use an isolated worktree.",
      "Do not auto-merge into the source repository.",
    ],
    nonGoals: ["Automatic PR creation", "Automatic conflict resolution"],
    riskLevel: "medium",
    contextPaths: ["README.md", "apps/web/src/app/page.tsx"],
    tasks: [
      {
        id: "task-copy",
        title: "Create checkout copy patch",
        agent: "shell",
        instructions:
          "Update checkout copy in an isolated worktree and leave evidence for review.",
      },
    ],
    qualityGates: [
      {
        id: "gate-unit",
        title: "Unit smoke gate",
        command: "npm test",
        required: true,
      },
    ],
  };
}

async function main() {
  const smokeRoot = await mkdtemp(join(tmpdir(), "mawo-smoke-requirements-"));
  const app = buildApp(undefined, {
    demoRoot: smokeRoot,
    env: {
      ...process.env,
      MAWO_API_TOKEN: operatorToken,
      MAWO_VIEWER_API_TOKEN: viewerToken,
    },
  });
  const failures: string[] = [];

  try {
    await app.ready();
    log("checking frozen /requirements auth and create contract");

    const viewerList = await request(
      app,
      "GET",
      "/requirements",
      undefined,
      viewerToken,
    );
    log(`viewer GET /requirements -> ${viewerList.status}`);
    check(
      failures,
      viewerList.status === 200,
      `Viewer GET /requirements returned ${viewerList.status}; expected 200 with a requirement ticket array. Add /requirements to viewer-readable routes and implement GET /requirements.`,
    );
    check(
      failures,
      Array.isArray(viewerList.body),
      "Viewer GET /requirements did not return an array body.",
    );

    const viewerCreate = await request(
      app,
      "POST",
      "/requirements",
      createRequirementPayload(),
      viewerToken,
    );
    log(`viewer POST /requirements -> ${viewerCreate.status}`);
    check(
      failures,
      viewerCreate.status === 403,
      `Viewer POST /requirements returned ${viewerCreate.status}; expected 403 forbidden.`,
    );
    check(
      failures,
      isObject(viewerCreate.body) &&
        viewerCreate.body.error === "forbidden" &&
        viewerCreate.body.role === "viewer",
      "Viewer write denial did not include the expected forbidden viewer body.",
    );

    const operatorCreate = await request(
      app,
      "POST",
      "/requirements",
      createRequirementPayload(),
    );
    log(`operator POST /requirements -> ${operatorCreate.status}`);
    check(
      failures,
      operatorCreate.status === 201,
      `Operator POST /requirements returned ${operatorCreate.status}; expected 201 for a structured requirement ticket.`,
    );

    if (isObject(operatorCreate.body)) {
      check(
        failures,
        typeof operatorCreate.body.id === "string",
        "Created requirement did not include a string id.",
      );
      check(
        failures,
        operatorCreate.body.title === "Smoke requirement: gated checkout copy",
        "Created requirement did not echo the structured title.",
      );
      check(
        failures,
        Array.isArray(operatorCreate.body.acceptanceCriteria),
        "Created requirement did not preserve acceptanceCriteria as an array.",
      );
      check(
        failures,
        Array.isArray(operatorCreate.body.tasks),
        "Created requirement did not preserve tasks as an array.",
      );
      check(
        failures,
        Array.isArray(operatorCreate.body.qualityGates),
        "Created requirement did not preserve qualityGates as an array.",
      );
    }

    const requirementId = isObject(operatorCreate.body)
      ? operatorCreate.body.id
      : undefined;

    if (typeof requirementId === "string") {
      const viewerDetail = await request(
        app,
        "GET",
        `/requirements/${requirementId}`,
        undefined,
        viewerToken,
      );
      log(`viewer GET /requirements/:id -> ${viewerDetail.status}`);
      check(
        failures,
        viewerDetail.status === 200,
        `Viewer GET /requirements/:id returned ${viewerDetail.status}; expected 200 for readable ticket details.`,
      );

      const report = await request(
        app,
        "GET",
        `/requirements/${requirementId}/report`,
        undefined,
        viewerToken,
      );
      log(`viewer GET /requirements/:id/report -> ${report.status}`);
      check(
        failures,
        report.status === 200 || report.status === 409,
        `Viewer GET /requirements/:id/report returned ${report.status}; expected 200 evidence or 409 not-ready without auth denial.`,
      );

      const mergeCandidate = await request(
        app,
        "GET",
        `/requirements/${requirementId}/merge-candidate`,
        undefined,
        viewerToken,
      );
      log(
        `viewer GET /requirements/:id/merge-candidate -> ${mergeCandidate.status}`,
      );
      check(
        failures,
        mergeCandidate.status === 200 || mergeCandidate.status === 409,
        `Viewer GET /requirements/:id/merge-candidate returned ${mergeCandidate.status}; expected 200 candidate or 409 not-ready without auth denial.`,
      );
    } else {
      log(
        "skipping detail/report/merge-candidate checks because create did not return an id",
      );
    }

    if (failures.length) {
      throw new Error(
        `${failures.length} requirement API smoke check(s) failed:\n- ${failures.join(
          "\n- ",
        )}`,
      );
    }

    log("requirements API contract smoke passed");
  } finally {
    await app.close();
    await rm(smokeRoot, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error("[smoke:api:requirements] failed");
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : error,
  );
  process.exitCode = 1;
});
