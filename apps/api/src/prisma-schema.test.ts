import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const schemaPath = "apps/api/prisma/schema.prisma";
const migrationsRoot = "apps/api/prisma/migrations";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function latestMigrationSql(): string {
  if (!existsSync(migrationsRoot)) {
    return "";
  }

  const migration = readdirSync(migrationsRoot)
    .filter((entry) => entry.includes("runtime_state"))
    .sort()
    .at(-1);

  return migration ? read(join(migrationsRoot, migration, "migration.sql")) : "";
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
  });

  it("ships a baseline migration for the runtime schema", () => {
    const migration = latestMigrationSql();

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
});
