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
      status: "passed",
    },
  ],
  qualityGates: [
    {
      id: "gate-1",
      title: "Unit tests",
      status: "passed",
    },
  ],
};

function renderConsoleFor(workflows: WorkflowRun[]): string {
  return renderToStaticMarkup(
    createElement(RequirementDeliveryConsole, {
      model: buildDeliveryConsoleModel(workflows),
    }),
  );
}

describe("RequirementDeliveryConsole", () => {
  it("renders the requirement-first console without making legacy runs primary", () => {
    const html = renderConsoleFor([workflow]);

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
    expect(html).not.toContain("Shell Run");
    expect(html.indexOf("New Requirement")).toBeLessThan(
      html.indexOf("Legacy Run Console"),
    );
  });

  it("shows required gate failure evidence without raw logs", () => {
    const html = renderConsoleFor([
      {
        ...workflow,
        id: "workflow-gate-failed",
        goal: "Update billing copy",
        status: "gate_failed",
        qualityGates: [
          {
            id: "gate-1",
            title: "Required unit tests",
            status: "failed",
            result: {
              exitCode: 1,
              stdout: '{"internal":"raw-gate-log"}',
              stderr: "stacktrace: private failure details",
            },
          },
        ],
      },
    ]);

    expect(html).toContain("Gate Result / Review Evidence");
    expect(html).toContain("Required gate failed");
    expect(html).toContain("Merge-ready blocked");
    expect(html).toContain("Retry failed gate");
    expect(html).not.toContain("raw-gate-log");
    expect(html).not.toContain("stacktrace");
  });

  it("shows review merge candidate evidence for review-ready requirements", () => {
    const html = renderConsoleFor([workflow]);

    expect(html).toContain("Review merge candidate evidence");
    expect(html).toContain("Quality gates passed");
    expect(html).toContain("Manual review required");
    expect(html).not.toContain("Apply Candidate");
  });

  it("shows delivered evidence for approved completed requirements", () => {
    const html = renderConsoleFor([
      {
        ...workflow,
        id: "workflow-approved",
        status: "completed",
        review: {
          decision: "approved",
          note: "Looks ready",
          reviewedAt: "2026-06-06T10:30:00.000Z",
        },
      },
    ]);

    expect(html).toContain("Delivered evidence");
    expect(html).toContain("Approved delivery");
    expect(html).toContain("Review delivered evidence");
  });

  it("keeps write actions disabled in viewer mode", () => {
    const html = renderToStaticMarkup(
      createElement(RequirementDeliveryConsole, {
        model: buildDeliveryConsoleModel([workflow]),
        viewerMode: true,
      }),
    );

    expect(html).toContain("Viewer mode");
    expect(html).toContain("Write actions are disabled");
    expect(html).toContain("disabled");
  });
});
