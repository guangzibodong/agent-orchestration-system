import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CliAgentAdapter } from "./cli-agent-adapter.js";

const node = JSON.stringify(process.execPath);
const tempRoots: string[] = [];

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("CliAgentAdapter", () => {
  it("writes a prompt file, executes the configured command template, and captures metadata", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "mawo-cli-agent-test-"));
    tempRoots.push(workspace);
    await writeFile(join(workspace, "README.md"), "initial\n", "utf8");
    const adapter = new CliAgentAdapter({
      id: "fake-agent",
      label: "Fake Agent",
      commandTemplate: `${node} {promptFile}`
    });

    const result = await adapter.run({
      workspace,
      goal: "Append a line",
      instructions:
        "const fs = require('fs'); fs.appendFileSync('README.md', 'agent line\\\\n'); console.log('agent completed');"
    });

    expect(result.status).toBe("passed");
    expect(result.stdout).toContain("agent completed");
    expect(result.metadata).toBeDefined();
    expect(result.metadata?.agentId).toBe("fake-agent");
    expect(result.metadata?.promptFile).not.toContain(workspace);
    expect(await readFile(join(workspace, "README.md"), "utf8")).toContain(
      "agent line"
    );
  });

  it("marks failed CLI agent commands as failed while keeping stderr", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "mawo-cli-agent-fail-test-"));
    tempRoots.push(workspace);
    const adapter = new CliAgentAdapter({
      id: "fake-agent",
      label: "Fake Agent",
      commandTemplate: `${node} {promptFile}`
    });

    const result = await adapter.run({
      workspace,
      goal: "Fail",
      instructions: "console.error('agent failed'); process.exit(4);"
    });

    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("agent failed");
  });

  it("uses a CommonJS prompt file so Node fake agents work in type module workspaces", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "mawo-cli-agent-esm-test-"));
    tempRoots.push(workspace);
    await writeFile(join(workspace, "package.json"), '{"type":"module"}', "utf8");
    const adapter = new CliAgentAdapter({
      id: "fake-agent",
      label: "Fake Agent",
      commandTemplate: `${node} {promptFile}`
    });

    const result = await adapter.run({
      workspace,
      goal: "Run commonjs",
      instructions:
        "const fs = require('fs'); fs.writeFileSync('agent-output.txt', 'ok'); console.log('commonjs ok');"
    });

    expect(result.status).toBe("passed");
    expect(result.metadata?.promptFile).toMatch(/\.cjs$/);
    expect(result.stdout).toContain("commonjs ok");
  });
});
