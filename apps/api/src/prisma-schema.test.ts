import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const schemaPath = "apps/api/prisma/schema.prisma";
const migrationsRoot = "apps/api/prisma/migrations";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function latestRuntimeStateMigrationSql(): string {
  if (!existsSync(migrationsRoot)) {
    return "";
  }

  const migration = readdirSync(migrationsRoot)
    .filter((entry) => entry.includes("runtime_state"))
    .sort()
    .at(-1);

  return migration ? read(join(migrationsRoot, migration, "migration.sql")) : "";
}

function allMigrationSql(): string {
  if (!existsSync(migrationsRoot)) {
    return "";
  }

  return readdirSync(migrationsRoot)
    .sort()
    .map((migration) => read(join(migrationsRoot, migration, "migration.sql")))
    .join("\n");
}

describe("Prisma runtime schema", () => {
  it("models every durable runtime record used by production workflows", () => {
    const schema = read(schemaPath);

    for (const model of [
      "WorkflowRun",
      "WorkflowTaskRun",
      "QualityGateRun",
      "WorkflowJob",
      "RepositoryRecord",
      "AuditEvent",
      "ArtifactRecord",
      "MergeCandidateRecord"
    ]) {
      expect(schema).toContain(`model ${model}`);
    }

    expect(schema).toMatch(/executionMode\s+String\s+@default\("direct"\)/);
    expect(schema).toMatch(/tasks\s+WorkflowTaskRun\[\]/);
    expect(schema).toMatch(/qualityGates\s+QualityGateRun\[\]/);
    expect(schema).toMatch(/jobs\s+WorkflowJob\[\]/);
    expect(schema).toMatch(/auditEvents\s+AuditEvent\[\]/);
    expect(schema).toMatch(/qualityGates\s+Json/);
    expect(schema).toMatch(/dependsOn\s+Json\?/);
    expect(schema).toMatch(/result\s+Json\?/);
    expect(schema).toMatch(/workspace\s+Json\?/);
    expect(schema).toMatch(/diff\s+Json\?/);
    expect(schema).toMatch(/metadata\s+Json\?/);
    expect(schema).toMatch(/lockedBy\s+String\?/);
    expect(schema).toMatch(/lockedAt\s+DateTime\?/);
    expect(schema).toMatch(/leaseExpiresAt\s+DateTime\?/);
    expect(schema).toMatch(/attempts\s+Int\s+@default\(0\)/);
    expect(schema).toContain("@@index([status, leaseExpiresAt])");
  });

  it("ships a baseline migration for the runtime schema", () => {
    const migration = latestRuntimeStateMigrationSql();

    for (const table of [
      "WorkflowRun",
      "WorkflowTaskRun",
      "QualityGateRun",
      "WorkflowJob",
      "RepositoryRecord",
      "AuditEvent",
      "ArtifactRecord",
      "MergeCandidateRecord"
    ]) {
      expect(migration).toContain(`CREATE TABLE "${table}"`);
    }

    expect(migration).toContain("CREATE UNIQUE INDEX");
    expect(migration).toContain("CREATE INDEX");
    expect(migration).toContain("ON DELETE CASCADE");
  });

  it("ships a migration for Postgres worker job leases", () => {
    const migrations = allMigrationSql();

    expect(migrations).toContain('ALTER TABLE "WorkflowJob" ADD COLUMN "lockedBy"');
    expect(migrations).toContain('ALTER TABLE "WorkflowJob" ADD COLUMN "lockedAt"');
    expect(migrations).toContain(
      'ALTER TABLE "WorkflowJob" ADD COLUMN "leaseExpiresAt"'
    );
    expect(migrations).toContain('ALTER TABLE "WorkflowJob" ADD COLUMN "attempts"');
    expect(migrations).toContain(
      'CREATE INDEX "WorkflowJob_status_leaseExpiresAt_idx"'
    );
  });
});
