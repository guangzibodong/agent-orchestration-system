import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  createRequirementDeliveryTicketRequestSchema,
  requirementDeliveryTicketSchema,
  updateRequirementDeliveryTicketRequestSchema,
  type CreateRequirementDeliveryTicketRequest,
  type RequirementDeliveryTicket,
  type RequirementStatus,
  type UpdateRequirementDeliveryTicketRequest,
} from "@mawo/shared";
import { writeJsonFileAtomically } from "./atomic-json-file.js";

export type MaybePromise<T> = T | Promise<T>;

export type RequirementStore = {
  list(): MaybePromise<RequirementDeliveryTicket[]>;
  get(id: string): MaybePromise<RequirementDeliveryTicket | undefined>;
  create(
    input: CreateRequirementDeliveryTicketRequest,
  ): MaybePromise<RequirementDeliveryTicket>;
  update(
    id: string,
    input: UpdateRequirementDeliveryTicketRequest,
  ): MaybePromise<RequirementDeliveryTicket | undefined>;
  confirmPlan(id: string): MaybePromise<RequirementDeliveryTicket | undefined>;
};

export type FileRequirementStoreOptions = {
  stateFile: string;
};

export class RequirementPlanNotReadyError extends Error {
  readonly missingFields: string[];

  constructor(missingFields: string[]) {
    super(
      `Requirement plan is missing required fields: ${missingFields.join(", ")}`,
    );
    this.name = "RequirementPlanNotReadyError";
    this.missingFields = missingFields;
  }
}

export class RequirementPlanConfirmationBlockedError extends Error {
  readonly status: RequirementStatus;

  constructor(status: RequirementStatus) {
    super(`Requirement status ${status} cannot be confirmed as a plan.`);
    this.name = "RequirementPlanConfirmationBlockedError";
    this.status = status;
  }
}

const CONFIRMABLE_STATUSES = new Set<RequirementStatus>([
  "draft",
  "needs_clarification",
  "plan_review",
]);

const PLANNING_STATUSES = new Set<RequirementStatus>([
  "draft",
  "needs_clarification",
  "plan_review",
]);

const PLANNING_FIELDS = new Set<keyof UpdateRequirementDeliveryTicketRequest>([
  "title",
  "repositoryId",
  "repositoryPath",
  "goal",
  "acceptanceCriteria",
  "constraints",
  "nonGoals",
  "riskLevel",
  "contextPaths",
  "tasks",
  "qualityGates",
]);

export class FileRequirementStore implements RequirementStore {
  private readonly stateFile: string;

  constructor(options: FileRequirementStoreOptions) {
    this.stateFile = options.stateFile;
  }

  list(): RequirementDeliveryTicket[] {
    try {
      const parsed = JSON.parse(
        readFileSync(this.stateFile, "utf8"),
      ) as unknown[];
      return parsed.map((requirement) =>
        requirementDeliveryTicketSchema.parse(requirement),
      );
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return [];
      }

      throw error;
    }
  }

  get(id: string): RequirementDeliveryTicket | undefined {
    return this.list().find((requirement) => requirement.id === id);
  }

  create(
    input: CreateRequirementDeliveryTicketRequest,
  ): RequirementDeliveryTicket {
    const parsed = createRequirementDeliveryTicketRequestSchema.parse(input);
    const now = new Date().toISOString();
    const ticket = requirementDeliveryTicketSchema.parse({
      id: randomUUID(),
      title: parsed.title,
      repositoryId: parsed.repositoryId,
      repositoryPath: parsed.repositoryPath,
      goal: parsed.goal ?? "",
      acceptanceCriteria: parsed.acceptanceCriteria,
      constraints: parsed.constraints,
      nonGoals: parsed.nonGoals,
      riskLevel: parsed.riskLevel,
      contextPaths: parsed.contextPaths,
      tasks: parsed.tasks,
      qualityGates: parsed.qualityGates,
      status: "needs_clarification",
      runLinks: [],
      createdAt: now,
      updatedAt: now,
    });
    const withStatus = {
      ...ticket,
      status: derivePlanningStatus(ticket),
    };

    this.write([...this.list(), withStatus]);

    return withStatus;
  }

  update(
    id: string,
    input: UpdateRequirementDeliveryTicketRequest,
  ): RequirementDeliveryTicket | undefined {
    const parsed = updateRequirementDeliveryTicketRequestSchema.parse(input);
    const requirements = this.list();
    const index = requirements.findIndex(
      (requirement) => requirement.id === id,
    );

    if (index < 0) {
      return undefined;
    }

    const existing = requirements[index]!;
    const updated = requirementDeliveryTicketSchema.parse({
      ...existing,
      ...parsed,
      updatedAt: new Date().toISOString(),
    });
    const status = deriveUpdatedStatus(existing, updated, parsed);
    const next = requirementDeliveryTicketSchema.parse({
      ...updated,
      status,
    });
    const nextRequirements = requirements.map((requirement, currentIndex) =>
      currentIndex === index ? next : requirement,
    );

    this.write(nextRequirements);

    return next;
  }

  confirmPlan(id: string): RequirementDeliveryTicket | undefined {
    const requirements = this.list();
    const index = requirements.findIndex(
      (requirement) => requirement.id === id,
    );

    if (index < 0) {
      return undefined;
    }

    const existing = requirements[index]!;
    if (!CONFIRMABLE_STATUSES.has(existing.status)) {
      throw new RequirementPlanConfirmationBlockedError(existing.status);
    }

    const missingFields = getMissingPlanFields(existing);
    if (missingFields.length > 0) {
      throw new RequirementPlanNotReadyError(missingFields);
    }

    const confirmed = requirementDeliveryTicketSchema.parse({
      ...existing,
      status: "ready_to_run",
      updatedAt: new Date().toISOString(),
    });
    const nextRequirements = requirements.map((requirement, currentIndex) =>
      currentIndex === index ? confirmed : requirement,
    );

    this.write(nextRequirements);

    return confirmed;
  }

  private write(requirements: RequirementDeliveryTicket[]): void {
    writeJsonFileAtomically(this.stateFile, requirements);
  }
}

function deriveUpdatedStatus(
  existing: RequirementDeliveryTicket,
  updated: RequirementDeliveryTicket,
  patch: UpdateRequirementDeliveryTicketRequest,
): RequirementStatus {
  const planningFieldChanged = Object.keys(patch).some((key) =>
    PLANNING_FIELDS.has(key as keyof UpdateRequirementDeliveryTicketRequest),
  );

  if (PLANNING_STATUSES.has(existing.status)) {
    return derivePlanningStatus(updated);
  }

  if (existing.status === "ready_to_run" && planningFieldChanged) {
    return derivePlanningStatus(updated);
  }

  return existing.status;
}

function derivePlanningStatus(
  ticket: RequirementDeliveryTicket,
): RequirementStatus {
  return getMissingPlanFields(ticket).length === 0
    ? "plan_review"
    : "needs_clarification";
}

function getMissingPlanFields(ticket: RequirementDeliveryTicket): string[] {
  return [
    !ticket.repositoryId && !ticket.repositoryPath ? "repository" : undefined,
    ticket.goal.trim().length === 0 ? "goal" : undefined,
    ticket.acceptanceCriteria.length === 0 ? "acceptanceCriteria" : undefined,
    ticket.tasks.length === 0 ? "tasks" : undefined,
    ticket.qualityGates.length === 0 ? "qualityGates" : undefined,
  ].filter((field): field is string => Boolean(field));
}
