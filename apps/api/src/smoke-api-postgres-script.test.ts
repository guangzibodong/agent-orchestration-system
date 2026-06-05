import { describe, expect, it } from "vitest";
import {
  assertPostgresRuntimeReady,
  requireDatabaseUrl
} from "./postgres-smoke-helpers.js";

describe("postgres API smoke helpers", () => {
  it("requires an explicit database url before running the postgres smoke", () => {
    expect(() => requireDatabaseUrl({})).toThrow("DATABASE_URL is required");
    expect(
      requireDatabaseUrl({
        DATABASE_URL: "postgresql://mawo:mawo@localhost:5432/mawo?schema=public"
      })
    ).toBe("postgresql://mawo:mawo@localhost:5432/mawo?schema=public");
  });

  it("requires readiness to report postgres as the active state backend", () => {
    expect(() =>
      assertPostgresRuntimeReady([
        {
          id: "runtime_backend",
          ok: true,
          activeStateBackend: "file",
          activeQueueBackend: "in_process"
        }
      ])
    ).toThrow("activeStateBackend=postgres");

    expect(() =>
      assertPostgresRuntimeReady([
        {
          id: "runtime_backend",
          ok: true,
          activeStateBackend: "postgres",
          activeQueueBackend: "in_process"
        }
      ])
    ).not.toThrow();
  });
});
