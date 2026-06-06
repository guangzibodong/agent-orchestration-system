export type NewRequirementRiskLevel = "low" | "medium" | "high";

export type NewRequirementDraft = {
  title: string;
  repositoryPath: string;
  repositoryId: string;
  goal: string;
  acceptanceCriteria: string;
  constraints: string;
  nonGoals: string;
  contextPaths: string;
  riskLevel: string;
  tasks: string[];
  qualityGates: string;
};

export type NewRequirementPayload = {
  title: string;
  repositoryPath?: string;
  repositoryId?: string;
  goal: string;
  acceptanceCriteria: string[];
  constraints: string[];
  nonGoals: string[];
  contextPaths: string[];
  riskLevel: NewRequirementRiskLevel;
  tasks: Array<{ title: string; agent: "shell"; instructions: string }>;
  qualityGates: Array<{ title: string; command: string; required: true }>;
};

export type NewRequirementPayloadResult =
  | { ok: true; payload: NewRequirementPayload }
  | { ok: false; errors: string[] };

const riskLevels = new Set<NewRequirementRiskLevel>(["low", "medium", "high"]);

export function buildNewRequirementPayload(
  draft: NewRequirementDraft,
): NewRequirementPayloadResult {
  const title = cleanValue(draft.title);
  const repositoryPath = cleanValue(draft.repositoryPath);
  const repositoryId = cleanValue(draft.repositoryId);
  const goal = cleanValue(draft.goal);
  const acceptanceCriteria = parseList(draft.acceptanceCriteria);
  const constraints = parseList(draft.constraints);
  const nonGoals = parseList(draft.nonGoals);
  const contextPaths = parseList(draft.contextPaths);
  const tasks = draft.tasks.map(cleanListItem).filter(Boolean);
  const qualityGates = parseList(draft.qualityGates);
  const riskLevel = normalizeRiskLevel(draft.riskLevel);
  const errors = new Array<string>();

  if (!title) {
    errors.push("Title is required.");
  }

  if (!repositoryPath && !repositoryId) {
    errors.push("Add a repository path or ID.");
  }

  if (!goal) {
    errors.push("Goal is required.");
  }

  if (!acceptanceCriteria.length) {
    errors.push("Add at least one acceptance criterion.");
  }

  if (tasks.length < 1 || tasks.length > 5) {
    errors.push("Add 1-5 tasks.");
  }

  if (!qualityGates.length) {
    errors.push("Add at least one required quality gate.");
  }

  if (!riskLevel) {
    errors.push("Choose a risk level.");
  }

  if (errors.length || !riskLevel) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    payload: {
      title,
      ...(repositoryPath ? { repositoryPath } : {}),
      ...(repositoryId ? { repositoryId } : {}),
      goal,
      acceptanceCriteria,
      constraints,
      nonGoals,
      contextPaths,
      riskLevel,
      tasks: tasks.map((taskTitle) => ({
        title: taskTitle,
        agent: "shell",
        instructions: taskTitle,
      })),
      qualityGates: qualityGates.map((gateCommand) => ({
        title: gateCommand,
        command: gateCommand,
        required: true,
      })),
    },
  };
}

export function submitNewRequirementDraft(
  draft: NewRequirementDraft,
  onSubmit: (payload: NewRequirementPayload) => void,
): NewRequirementPayloadResult {
  const result = buildNewRequirementPayload(draft);

  if (result.ok) {
    onSubmit(result.payload);
  }

  return result;
}

export function newRequirementDraftFromFormData(
  formData: FormData,
): NewRequirementDraft {
  return {
    title: getFormValue(formData, "title"),
    repositoryPath: getFormValue(formData, "repositoryPath"),
    repositoryId: getFormValue(formData, "repositoryId"),
    goal: getFormValue(formData, "goal"),
    acceptanceCriteria: getFormValue(formData, "acceptanceCriteria"),
    constraints: getFormValue(formData, "constraints"),
    nonGoals: getFormValue(formData, "nonGoals"),
    contextPaths: getFormValue(formData, "contextPaths"),
    riskLevel: getFormValue(formData, "riskLevel"),
    tasks: formData.getAll("tasks").map((value) => String(value)),
    qualityGates: getFormValue(formData, "qualityGates"),
  };
}

function getFormValue(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}

function parseList(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map(cleanListItem)
    .filter(Boolean);
}

function cleanListItem(value: string): string {
  return cleanValue(value)
    .replace(/^[-*]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .trim();
}

function cleanValue(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeRiskLevel(value: string): NewRequirementRiskLevel | undefined {
  const normalized = value.trim().toLowerCase();

  return riskLevels.has(normalized as NewRequirementRiskLevel)
    ? (normalized as NewRequirementRiskLevel)
    : undefined;
}
