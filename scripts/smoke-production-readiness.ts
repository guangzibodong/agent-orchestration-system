import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../apps/api/src/server.js";
import {
  assertProductionReadinessSmokeReady,
  type SmokeJsonObject,
} from "../apps/api/src/production-readiness-smoke-helpers.js";

const tempRoots: string[] = [];

function log(message: string) {
  console.log(`[smoke:readiness:production] ${message}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function request(
  baseUrl: string,
  method: string,
  path: string,
  authToken?: string,
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
    },
  });
  const text = await response.text();
  const body = text ? (JSON.parse(text) as SmokeJsonObject) : {};

  return {
    status: response.status,
    body,
  };
}

async function removeTempRoot(root: string): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await rm(root, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 5) {
        console.warn(
          `[smoke:readiness:production] warning: could not remove temp root ${root}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return;
      }

      await new Promise((resolveDelay) =>
        setTimeout(resolveDelay, 250 * (attempt + 1)),
      );
    }
  }
}

async function main() {
  const smokeRoot = await mkdtemp(
    join(tmpdir(), "mawo-production-readiness-"),
  );
  tempRoots.push(smokeRoot);
  const repositoryRoot = join(smokeRoot, "repositories");
  await mkdir(repositoryRoot, { recursive: true });

  const token = "production-readiness-token-1234567890";
  const app = buildApp(undefined, {
    demoRoot: smokeRoot,
    env: {
      NODE_ENV: "production",
      MAWO_API_TOKEN: token,
      MAWO_ALLOWED_REPOSITORY_ROOTS: repositoryRoot,
      MAWO_STATE_BACKEND: "file",
      MAWO_QUEUE_BACKEND: "in_process",
      MAWO_API_REPLICA_COUNT: "1",
      MAWO_MAX_CONCURRENT_JOBS: "1",
    },
  });

  try {
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    assert(
      address && typeof address === "object",
      "API server did not expose a TCP address.",
    );
    const baseUrl = `http://127.0.0.1:${address.port}`;
    log(`API listening on ${baseUrl}`);

    const health = await request(baseUrl, "GET", "/health");
    assert(health.status === 200, `GET /health returned ${health.status}`);
    assert(health.body.ok === true, "GET /health did not return ok=true.");
    log("health endpoint remains public");

    const rejectedReadiness = await request(baseUrl, "GET", "/readiness");
    assert(
      rejectedReadiness.status === 401,
      `Unauthenticated GET /readiness returned ${rejectedReadiness.status}`,
    );
    log("readiness endpoint rejects unauthenticated production access");

    const readiness = await request(baseUrl, "GET", "/readiness", token);
    assert(
      readiness.status === 200,
      `Authenticated GET /readiness returned ${readiness.status}`,
    );
    assertProductionReadinessSmokeReady(readiness.body);
    log("readiness reports protected file-backed production config ready");
  } finally {
    await app.close();
    for (const root of tempRoots.splice(0).reverse()) {
      await removeTempRoot(root);
    }
  }
}

main().catch((error: unknown) => {
  console.error("[smoke:readiness:production] failed");
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
