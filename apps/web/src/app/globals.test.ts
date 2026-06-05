import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "globals.css"), "utf8");

function ruleFor(selector: string): string {
  const rules = [...css.matchAll(/(?<selectors>[^{}]+)\{(?<body>[^}]*)\}/g)];
  const matchingBodies = rules
    .filter((rule) =>
      (rule.groups?.selectors ?? "")
        .split(",")
        .map((item) => item.trim())
        .includes(selector)
    )
    .map((rule) => rule.groups?.body ?? "");

  return matchingBodies.join("\n");
}

describe("global layout resilience styles", () => {
  it("keeps long workflow titles, job ids, reports, and patch text contained", () => {
    const selectors = [
      "h2",
      ".jobBanner",
      ".jobTimelineItem p",
      ".reportBox p",
      ".runItem pre",
      ".workflowNode"
    ];

    for (const selector of selectors) {
      expect(ruleFor(selector), selector).toContain("overflow-wrap: anywhere");
    }
  });

  it("lets dense toolbars and grids shrink instead of overflowing mobile viewports", () => {
    expect(ruleFor(".topbar")).toContain("min-width: 0");
    expect(ruleFor(".actions")).toContain("flex-wrap: wrap");
    expect(ruleFor(".primaryButton")).toContain("white-space: normal");
    expect(ruleFor(".consoleGrid")).toContain("min-width: 0");
  });
});
