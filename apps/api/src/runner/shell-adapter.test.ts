import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ShellAdapter } from "./shell-adapter.js";

const node = JSON.stringify(process.execPath);
const tempRoots: string[] = [];

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("ShellAdapter", () => {
  it("captures stdout, stderr, exit code, and duration for a successful command", async () => {
    const adapter = new ShellAdapter();

    const result = await adapter.run({
      command: `${node} -e "process.stdout.write('ok'); process.stderr.write('note')"`
    });

    expect(result.status).toBe("passed");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("ok");
    expect(result.stderr).toBe("note");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("marks a non-zero command as failed while preserving logs", async () => {
    const adapter = new ShellAdapter();

    const result = await adapter.run({
      command: `${node} -e "console.log('before failure'); process.exit(7)"`
    });

    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(7);
    expect(result.stdout).toContain("before failure");
  });

  it("fails and marks commands that exceed their timeout", async () => {
    const adapter = new ShellAdapter();

    const result = await adapter.run({
      command: `${node} -e "setTimeout(() => console.log('too late'), 1000)"`,
      timeoutMs: 50
    });

    expect(result.status).toBe("failed");
    expect(result.metadata?.timedOut).toBe("true");
    expect(result.stderr).toContain("timed out after 50ms");
  });

  it("cancels a running command when the abort signal fires", async () => {
    const root = await mkdtemp(join(tmpdir(), "mawo-shell-cancel-test-"));
    tempRoots.push(root);
    const markerPath = join(root, "done.txt");
    const adapter = new ShellAdapter();
    const controller = new AbortController();

    const resultPromise = adapter.run({
      command: `${node} -e "setTimeout(() => require('fs').writeFileSync(process.argv[1], 'done'), 700)" ${JSON.stringify(markerPath)}`,
      signal: controller.signal
    });

    setTimeout(() => {
      controller.abort();
    }, 50);

    const result = await resultPromise;
    await new Promise((resolve) => setTimeout(resolve, 900));

    expect(result.status).toBe("canceled");
    expect(result.metadata?.canceled).toBe("true");
    expect(result.stderr).toContain("Command canceled");
    expect(existsSync(markerPath)).toBe(false);
  });

  it("does not start commands when the abort signal is already canceled", async () => {
    const root = await mkdtemp(join(tmpdir(), "mawo-shell-pre-cancel-test-"));
    tempRoots.push(root);
    const markerPath = join(root, "done.txt");
    const adapter = new ShellAdapter();
    const controller = new AbortController();
    controller.abort();

    const result = await adapter.run({
      command: `${node} -e "require('fs').writeFileSync(process.argv[1], 'done')" ${JSON.stringify(markerPath)}`,
      signal: controller.signal
    });

    expect(result.status).toBe("canceled");
    expect(result.metadata?.canceled).toBe("true");
    expect(result.stderr).toContain("Command canceled");
    expect(existsSync(markerPath)).toBe(false);
  });
});
