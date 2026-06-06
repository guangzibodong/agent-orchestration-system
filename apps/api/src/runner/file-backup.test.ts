import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createFileStateBackup,
  restoreFileStateBackup
} from "./file-backup.js";

const tempRoots: string[] = [];

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("file state backup helpers", () => {
  it("backs up and restores .mawo state plus artifacts without restoring the manifest into state", async () => {
    const root = await mkdtemp(join(tmpdir(), "mawo-file-backup-test-"));
    tempRoots.push(root);
    const mawoRoot = join(root, ".mawo");
    const backupRoot = join(root, ".backups");
    await mkdir(join(mawoRoot, "state"), { recursive: true });
    await mkdir(join(mawoRoot, "artifacts", "workflow-1"), {
      recursive: true
    });
    await writeFile(
      join(mawoRoot, "state", "workflows.json"),
      JSON.stringify([{ id: "workflow-1", status: "needs_review" }]),
      "utf8"
    );
    await writeFile(
      join(mawoRoot, "artifacts", "workflow-1", "report.json"),
      JSON.stringify({ recommendation: "ready_for_review" }),
      "utf8"
    );

    const manifest = await createFileStateBackup({
      backupRoot,
      name: "mawo-smoke-backup",
      now: new Date("2026-06-06T08:00:00.000Z"),
      sourceDir: mawoRoot
    });
    await writeFile(
      join(mawoRoot, "state", "workflows.json"),
      JSON.stringify([{ id: "workflow-1", status: "corrupted" }]),
      "utf8"
    );

    const restoredManifest = await restoreFileStateBackup({
      backupPath: manifest.backupPath,
      targetDir: mawoRoot
    });

    await expect(
      readFile(join(mawoRoot, "state", "workflows.json"), "utf8")
    ).resolves.toContain("needs_review");
    await expect(
      readFile(join(mawoRoot, "artifacts", "workflow-1", "report.json"), "utf8")
    ).resolves.toContain("ready_for_review");
    await expect(
      readFile(join(mawoRoot, "mawo-backup-manifest.json"), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(restoredManifest).toMatchObject({
      backupPath: manifest.backupPath,
      createdAt: "2026-06-06T08:00:00.000Z",
      fileCount: 2,
      kind: "mawo-file-state",
      source: mawoRoot,
      version: 1
    });
    expect(restoredManifest.byteCount).toBeGreaterThan(0);
  });
});
