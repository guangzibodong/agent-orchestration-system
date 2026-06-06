import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("deployment manifests", () => {
  it("provides a production Dockerfile for API and web targets", () => {
    const dockerfile = read("Dockerfile");

    expect(dockerfile).toContain("AS api");
    expect(dockerfile).toContain("AS web");
    expect(dockerfile).toContain("npm run build");
    expect(dockerfile).toContain("npm run start -w @mawo/api");
    expect(dockerfile).toContain("npm run start -w @mawo/web");
  });

  it("runs API, web, and runtime state through docker compose", () => {
    const compose = read("docker-compose.yml");

    expect(compose).toContain("api:");
    expect(compose).toContain("migrate:");
    expect(compose).toContain("web:");
    expect(compose).toContain("target: api");
    expect(compose).toContain("target: web");
    expect(compose).toContain("container_name: mawo-migrate");
    expect(compose).toContain("npm run db:migrate:deploy");
    expect(compose).toContain("migrate:");
    expect(compose).toContain("condition: service_completed_successfully");
    expect(compose).toContain("API_HOST: 0.0.0.0");
    expect(compose).toContain("MAWO_STATE_BACKEND: ${MAWO_STATE_BACKEND:-file}");
    expect(compose).toContain(
      "MAWO_QUEUE_BACKEND: ${MAWO_QUEUE_BACKEND:-in_process}"
    );
    expect(compose).toContain("MAWO_MAX_CONCURRENT_JOBS: ${MAWO_MAX_CONCURRENT_JOBS:-1}");
    expect(compose).toContain("MAWO_API_REPLICA_COUNT: ${MAWO_API_REPLICA_COUNT:-1}");
    expect(compose).toContain("MAWO_API_TOKEN: ${MAWO_API_TOKEN:?");
    expect(compose).toContain(
      "MAWO_ALLOWED_REPOSITORY_ROOTS: ${MAWO_ALLOWED_REPOSITORY_ROOTS:?"
    );
    expect(compose).toContain("POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?");
    expect(compose).not.toContain("change-me-before-production");
    expect(compose).toContain("NEXT_PUBLIC_API_URL:");
    expect(compose).toContain("mawo_state:");
  });

  it("documents deploy-time environment variables", () => {
    const env = read(".env.example");

    expect(env).toContain("API_HOST=0.0.0.0");
    expect(env).toContain("API_PORT=4000");
    expect(env).toContain("MAWO_STATE_BACKEND=file");
    expect(env).toContain("MAWO_QUEUE_BACKEND=in_process");
    expect(env).toContain("MAWO_MAX_CONCURRENT_JOBS=1");
    expect(env).toContain("MAWO_API_REPLICA_COUNT=1");
    expect(env).toContain("MAWO_API_TOKEN=");
    expect(env).toContain("MAWO_ALLOWED_REPOSITORY_ROOTS=");
    expect(env).toContain("POSTGRES_PASSWORD=");
    expect(env).not.toContain("change-me-before-production");
    expect(env).toContain("NEXT_PUBLIC_API_URL=http://127.0.0.1:4000");
    expect(env).toContain("MAWO_CODEX_COMMAND_TEMPLATE=");
    expect(env).toContain("MAWO_CODEX_AUTH_PROBE_COMMAND=");
    expect(env).toContain("MAWO_WORKER_ID=");
    expect(env).toContain("MAWO_WORKER_ONCE=");
    expect(env).toContain("MAWO_WORKER_POLL_MS=");
    expect(env).toContain("MAWO_WORKER_LEASE_MS=");
    expect(env).toContain("MAWO_WORKER_RENEW_INTERVAL_MS=");
  });

  it("documents the database migration baseline", () => {
    const readme = read("README.md");
    const operations = read("docs/OPERATIONS.md");
    const packageJson = read("package.json");

    expect(readme).toContain("apps/api/prisma/migrations");
    expect(readme).toContain("npm run db:migrate");
    expect(readme).toContain("npm run db:migrate:deploy");
    expect(operations).toContain("apps/api/prisma/migrations");
    expect(operations).toContain("npm run db:migrate");
    expect(operations).toContain("npm run db:migrate:deploy");
    expect(packageJson).toContain("\"db:validate\"");
    expect(packageJson).toContain("\"db:migrate:deploy\"");
    expect(packageJson).toContain("\"smoke:api:postgres\"");
  });

  it("ignores runtime logs and generated verification artifacts", () => {
    const gitignore = read(".gitignore");

    expect(gitignore).toContain(".logs/");
    expect(gitignore).toContain("output/");
    expect(gitignore).toContain(".mawo/");
  });

  it("runs the production verification suite in GitHub Actions", () => {
    const workflow = read(".github/workflows/ci.yml");

    expect(workflow).toContain("on:");
    expect(workflow).toContain("push:");
    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("node-version: 26");
    expect(workflow).toContain("postgres:");
    expect(workflow).toContain("npm ci");
    expect(workflow).toContain("npm run db:validate");
    expect(workflow).toContain("npm run db:generate");
    expect(workflow).toContain("npm run db:migrate:deploy");
    expect(workflow).toContain("npm run test");
    expect(workflow).toContain("npm run typecheck");
    expect(workflow).toContain("npm run lint");
    expect(workflow).toContain("npm run build");
    expect(workflow).toContain("npm run smoke:api");
    expect(workflow).toContain("npm run smoke:api:postgres");
    expect(workflow).toContain("MAWO_API_TOKEN: smoke-secret");
  });

  it("provides a Postgres-backed API smoke entrypoint", () => {
    const wrapper = read("scripts/smoke-api-postgres.mjs");
    const smoke = read("scripts/smoke-api-postgres.ts");
    const helper = read("apps/api/src/postgres-smoke-helpers.ts");

    expect(wrapper).toContain("scripts/smoke-api-postgres.ts");
    expect(smoke).toContain("MAWO_STATE_BACKEND");
    expect(smoke).toContain('MAWO_QUEUE_BACKEND: "postgres"');
    expect(smoke).toContain("PostgresWorkflowWorker");
    expect(smoke).toContain("assertPostgresRuntimeReady");
    expect(smoke).toContain("worker.runOnce");
    expect(helper).toContain("activeStateBackend=postgres");
    expect(helper).toContain("activeQueueBackend=postgres");
    expect(smoke).toContain("prisma.workflowRun.findUnique");
    expect(smoke).toContain("prisma.workflowJob.findUnique");
  });

  it("provides a Postgres worker entrypoint for claimed workflow jobs", () => {
    const packageJson = read("package.json");
    const wrapper = read("scripts/worker-postgres.mjs");
    const worker = read("scripts/worker-postgres.ts");

    expect(packageJson).toContain("\"worker:postgres\"");
    expect(wrapper).toContain("scripts/worker-postgres.ts");
    expect(worker).toContain("PostgresWorkflowWorker");
    expect(worker).toContain("MAWO_WORKER_ONCE");
    expect(worker).toContain("PrismaJobStore");
    expect(worker).toContain("PrismaRunStore");
  });
});
