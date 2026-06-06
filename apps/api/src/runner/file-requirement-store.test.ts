import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createRequirementDeliveryTicketRequestSchema,
  decisionQueueItemSchema,
  requirementDeliveryTicketSchema,
  updateRequirementDeliveryTicketRequestSchema,
} from "@mawo/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FileRequirementStore,
  RequirementPlanNotReadyError,
} from "./file-requirement-store.js";

const tempRoots: string[] = [];

afterEach(async () => {
  vi.useRealTimers();

  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("RequirementDeliveryTicket contract", () => {
  it("accepts requirement ticket schemas with default required gates", () => {
    const createdRequest = createRequirementDeliveryTicketRequestSchema.parse({
      title: "Deliver safe README change",
    });
    const updatedRequest = updateRequirementDeliveryTicketRequestSchema.parse({
      acceptanceCriteria: ["README explains the manual apply path"],
    });
    const ticket = requirementDeliveryTicketSchema.parse({
      id: "requirement-1",
      title: "Deliver safe README change",
      repositoryPath: "C:/repo",
      goal: "Produce a reviewable patch",
      acceptanceCriteria: ["README explains the manual apply path"],
      constraints: ["Do not auto-merge"],
      nonGoals: ["Do not create a PR"],
      riskLevel: "medium",
      contextPaths: ["README.md"],
      tasks: [
        {
          id: "edit-readme",
          title: "Edit README",
          agent: "shell",
          command: "node scripts/edit-readme.js",
        },
      ],
      qualityGates: [
        {
          id: "tests",
          title: "Unit tests",
          command: "npm test",
        },
      ],
      status: "plan_review",
      currentWorkflowRunId: "workflow-1",
      runLinks: [
        {
          workflowRunId: "workflow-1",
          status: "ready",
          linkedAt: "2026-06-06T00:00:00.000Z",
        },
      ],
      createdAt: "2026-06-06T00:00:00.000Z",
      updatedAt: "2026-06-06T00:00:00.000Z",
    });
    const decision = decisionQueueItemSchema.parse({
      id: "requirement-1:confirm-plan",
      requirementId: "requirement-1",
      title: "Deliver safe README change",
      actionLabel: "Confirm plan",
      severity: "warning",
    });

    expect(createdRequest).toMatchObject({
      title: "Deliver safe README change",
      acceptanceCriteria: [],
      tasks: [],
      qualityGates: [],
    });
    expect(updatedRequest.acceptanceCriteria).toEqual([
      "README explains the manual apply path",
    ]);
    expect(ticket.qualityGates[0]?.required).toBe(true);
    expect(ticket.runLinks[0]?.workflowRunId).toBe("workflow-1");
    expect(decision.actionLabel).toBe("Confirm plan");
  });
});

describe("FileRequirementStore", () => {
  it("persists requirement tickets and confirms complete plans", async () => {
    const root = await mkdtemp(join(tmpdir(), "mawo-requirement-store-test-"));
    tempRoots.push(root);
    const store = new FileRequirementStore({
      stateFile: join(root, "state", "requirements.json"),
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-06T00:00:00.000Z"));
    const draft = store.create({
      title: "Deliver safe README change",
    });

    vi.setSystemTime(new Date("2026-06-06T00:01:00.000Z"));
    const planned = store.update(draft.id, {
      repositoryPath: "C:/repo",
      goal: "Produce a reviewable patch",
      acceptanceCriteria: ["README explains the manual apply path"],
      constraints: ["Do not auto-merge"],
      nonGoals: ["Do not create a PR"],
      contextPaths: ["README.md"],
      tasks: [
        {
          id: "edit-readme",
          title: "Edit README",
          agent: "shell",
          command: "node scripts/edit-readme.js",
        },
      ],
      qualityGates: [
        {
          id: "tests",
          title: "Unit tests",
          command: "npm test",
        },
      ],
    });

    vi.setSystemTime(new Date("2026-06-06T00:02:00.000Z"));
    const confirmed = store.confirmPlan(draft.id);
    const restored = new FileRequirementStore({
      stateFile: join(root, "state", "requirements.json"),
    });

    expect(draft).toMatchObject({
      title: "Deliver safe README change",
      status: "needs_clarification",
      acceptanceCriteria: [],
      tasks: [],
      qualityGates: [],
      createdAt: "2026-06-06T00:00:00.000Z",
      updatedAt: "2026-06-06T00:00:00.000Z",
    });
    expect(planned).toMatchObject({
      id: draft.id,
      status: "plan_review",
      updatedAt: "2026-06-06T00:01:00.000Z",
    });
    expect(confirmed).toMatchObject({
      id: draft.id,
      status: "ready_to_run",
      updatedAt: "2026-06-06T00:02:00.000Z",
    });
    expect(restored.get(draft.id)).toEqual(confirmed);
  });

  it("rejects plan confirmation until the minimum runnable fields exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "mawo-requirement-block-test-"));
    tempRoots.push(root);
    const store = new FileRequirementStore({
      stateFile: join(root, "state", "requirements.json"),
    });
    const ticket = store.create({
      title: "Incomplete requirement",
    });

    expect(() => store.confirmPlan(ticket.id)).toThrow(
      RequirementPlanNotReadyError,
    );
  });
});
