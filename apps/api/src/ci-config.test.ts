import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("ci configuration", () => {
  it("uses a stable Node version and official npm registry", () => {
    const disallowedMirrorHost = ["registry", "npm" + "mirror", "com"].join(".");
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    const npmrc = readFileSync(".npmrc", "utf8");
    const lockfile = readFileSync("package-lock.json", "utf8");

    expect(workflow).toContain("node-version: 24");
    expect(workflow).toContain("registry-url: https://registry.npmjs.org");
    expect(workflow).toContain("npm config set registry https://registry.npmjs.org/");
    expect(workflow).toContain("cancel-in-progress: true");
    expect(npmrc).toContain("registry=https://registry.npmjs.org/");
    expect(lockfile).not.toContain(disallowedMirrorHost);
  });
});
