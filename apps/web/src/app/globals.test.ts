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
  it("gives the requirement console a layered dark operations surface with restrained accent tokens", () => {
    expect(css).toContain("--delivery-bg: #0b1020");
    expect(css).toContain("--delivery-panel: rgba(15, 23, 42, 0.92)");
    expect(css).toContain("--delivery-accent: #9ad7ff");
    expect(css).toContain("--delivery-amber: #f6c177");
    expect(css).toContain("--delivery-green: #7dd3a8");
    expect(ruleFor(".deliveryShell")).toContain("background:");
    expect(ruleFor(".deliveryPanel")).toContain("box-shadow:");
    expect(ruleFor(".primaryButton")).toContain("linear-gradient");
  });

  it("keeps the New Requirement repository safety contract inside the dark console system", () => {
    const contractRule = ruleFor(".newRequirementRepositoryContract");

    expect(contractRule).toContain("rgba(14, 42, 58");
    expect(contractRule).toContain("var(--delivery-accent)");
  });

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

  it("keeps requirement stage labels readable instead of forcing seven cramped columns", () => {
    const stageStepperRule = ruleFor(".stageStepper");

    expect(stageStepperRule).toContain("auto-fit");
    expect(stageStepperRule).toContain("96px");
    expect(stageStepperRule).not.toContain("repeat(7");
  });
});
