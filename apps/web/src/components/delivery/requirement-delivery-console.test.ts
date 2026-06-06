import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { WorkflowRun } from "@mawo/shared";
import { buildDeliveryConsoleModel } from "./delivery-console-model";
import { RequirementDeliveryConsole } from "./requirement-delivery-console";

const workflow: WorkflowRun = {
  id: "workflow-review",
  goal: "Harden auth checks",
  status: "needs_review",
  repositoryPath: "C:/work/api",
  updatedAt: "2026-06-06T10:10:00.000Z",
  tasks: [
    {
      id: "task-1",
      title: "Update auth guard",
      status: "passed"
    }
  ],
  qualityGates: [
    {
      id: "gate-1",
      title: "Unit tests",
      status: "passed"
    }
  ]
};

describe("RequirementDeliveryConsole", () => {
  it("renders the requirement-first console without making legacy runs primary", () => {
    const html = renderToStaticMarkup(
      createElement(RequirementDeliveryConsole, {
        model: buildDeliveryConsoleModel([workflow])
      })
    );

    expect(html).toContain("Requirement Delivery Console");
    expect(html).toContain("New Requirement");
    expect(html).toContain("Requirement Queue");
    expect(html).toContain("Repository Safety");
    expect(html).toContain("C:/work/api");
    expect(html).toContain("Apply clean check required");
    expect(html).toContain("Allowed root accepted by API");
    expect(html).toContain("Manual git apply only");
    expect(html).not.toContain("Branch, HEAD, clean/dirty state");
    expect(html).toContain("Stage Stepper");
    expect(html).toContain("Decision Queue");
    expect(html).toContain("Review merge candidate");
    expect(html).toContain("Legacy Run Console");
    expect(html).toContain("1 task / 1 gate / 2026-06-06T10:10:00.000Z");
    expect(html).not.toContain("路");
    expect(html).not.toContain("Shell Run");
    expect(html.indexOf("New Requirement")).toBeLessThan(
      html.indexOf("Legacy Run Console")
    );
  });

  it("keeps write actions disabled in viewer mode", () => {
    const html = renderToStaticMarkup(
      createElement(RequirementDeliveryConsole, {
        model: buildDeliveryConsoleModel([workflow]),
        viewerMode: true
      })
    );

    expect(html).toContain("Viewer mode");
    expect(html).toContain("Write actions are disabled");
    expect(html).toContain("disabled");
  });
});
