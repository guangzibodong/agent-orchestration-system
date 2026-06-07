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
  tasks: NewRequirementTaskDraft[];
  qualityGates: NewRequirementQualityGateDraft[] | string;
};

export type NewRequirementTaskDraft = {
  title: string;
  objective: string;
  acceptanceCriteria: string;
  agent: string;
  command: string;
  instructions: string;
  timeoutMs: string;
  dependsOn: string;
};

export type NewRequirementQualityGateDraft = {
  command: string;
  required: boolean;
  timeoutMs: string;
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
  tasks: Array<{
    id: string;
    title: string;
    objective?: string;
    acceptanceCriteria?: string[];
    agent: string;
    command?: string;
    instructions?: string;
    timeoutMs?: number;
    dependsOn?: string[];
  }>;
  qualityGates: Array<{
    title: string;
    command: string;
    required: boolean;
    timeoutMs?: number;
  }>;
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
  const taskCandidates = draft.tasks.map(buildTaskCandidate);
  const tasks = taskCandidates.filter((task) => task.hasAnyValue);
  const qualityGates = parseQualityGates(draft.qualityGates);
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

  if (tasks.some((task) => !task.title)) {
    errors.push("Each task needs a title.");
  }

  if (tasks.some((task) => !task.objective)) {
    errors.push("Each task needs an objective.");
  }

  if (tasks.some((task) => !task.acceptanceCriteria.length)) {
    errors.push("Each task needs task-level acceptance.");
  }

  if (tasks.some((task) => task.agent === "shell" && !task.command)) {
    errors.push("Shell tasks need a command.");
  }

  if (
    tasks.some(
      (task) => task.agent !== "shell" && !task.instructions && !task.command,
    )
  ) {
    errors.push("CLI agent tasks need instructions or a command.");
  }

  if (tasks.some((task) => task.timeoutMs === "invalid")) {
    errors.push("Task timeouts must be positive milliseconds.");
  }

  if (qualityGates.some((gate) => gate.timeoutMs === "invalid")) {
    errors.push("Quality gate timeouts must be positive milliseconds.");
  }

  if (!qualityGates.some((gate) => gate.required)) {
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
      tasks: tasks.map((task) => ({
        id: task.id,
        title: task.title,
        ...(task.objective ? { objective: task.objective } : {}),
        ...(task.acceptanceCriteria.length
          ? { acceptanceCriteria: task.acceptanceCriteria }
          : {}),
        agent: task.agent,
        ...(task.command ? { command: task.command } : {}),
        ...(task.instructions ? { instructions: task.instructions } : {}),
        ...(typeof task.timeoutMs === "number"
          ? { timeoutMs: task.timeoutMs }
          : {}),
        ...(task.dependsOn.length ? { dependsOn: task.dependsOn } : {}),
      })),
      qualityGates: qualityGates.map((gate) => ({
        title: gate.title,
        command: gate.command,
        required: gate.required,
        ...(typeof gate.timeoutMs === "number"
          ? { timeoutMs: gate.timeoutMs }
          : {}),
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
    tasks: getTaskDraftsFromFormData(formData),
    qualityGates: getQualityGateDraftsFromFormData(formData),
  };
}

function getTaskDraftsFromFormData(formData: FormData): NewRequirementTaskDraft[] {
  const titles = formData.getAll("taskTitle").map((value) => String(value));

  if (!titles.length) {
    return formData.getAll("tasks").map((value) => ({
      title: String(value),
      objective: "",
      acceptanceCriteria: "",
      agent: "shell",
      command: "",
      instructions: String(value),
      timeoutMs: "",
      dependsOn: "",
    }));
  }

  const agents = formData.getAll("taskAgent").map((value) => String(value));
  const objectives = formData
    .getAll("taskObjective")
    .map((value) => String(value));
  const acceptanceCriteria = formData
    .getAll("taskAcceptanceCriteria")
    .map((value) => String(value));
  const commands = formData.getAll("taskCommand").map((value) => String(value));
  const instructions = formData
    .getAll("taskInstructions")
    .map((value) => String(value));
  const timeoutMs = formData
    .getAll("taskTimeoutMs")
    .map((value) => String(value));
  const dependsOn = formData
    .getAll("taskDependsOn")
    .map((value) => String(value));

  return titles.map((title, index) => ({
    title,
    objective: objectives[index] ?? "",
    acceptanceCriteria: acceptanceCriteria[index] ?? "",
    agent: agents[index] ?? "shell",
    command: commands[index] ?? "",
    instructions: instructions[index] ?? "",
    timeoutMs: timeoutMs[index] ?? "",
    dependsOn: dependsOn[index] ?? "",
  }));
}

function getQualityGateDraftsFromFormData(
  formData: FormData,
): NewRequirementQualityGateDraft[] | string {
  const commands = formData.getAll("gateCommand").map((value) => String(value));

  if (!commands.length) {
    return getFormValue(formData, "qualityGates");
  }

  const required = formData
    .getAll("gateRequired")
    .map((value) => String(value));
  const timeoutMs = formData
    .getAll("gateTimeoutMs")
    .map((value) => String(value));

  return commands.map((command, index) => ({
    command,
    required: required[index] !== "false" && required[index] !== "optional",
    timeoutMs: timeoutMs[index] ?? "",
  }));
}

function buildTaskCandidate(task: NewRequirementTaskDraft, index: number) {
  const title = cleanListItem(task.title);
  const objective = cleanValue(task.objective);
  const acceptanceCriteria = parseList(task.acceptanceCriteria);
  const agent = cleanValue(task.agent) || "shell";
  const command = cleanValue(task.command);
  const instructions = cleanValue(task.instructions);
  const timeoutMs = parseOptionalPositiveInteger(task.timeoutMs);
  const dependsOn = parseDependencyList(task.dependsOn);

  return {
    id: `task-${index + 1}`,
    title,
    objective,
    acceptanceCriteria,
    agent,
    command,
    instructions,
    timeoutMs,
    dependsOn,
    hasAnyValue:
      Boolean(title) ||
      Boolean(objective) ||
      acceptanceCriteria.length > 0 ||
      Boolean(command) ||
      Boolean(instructions) ||
      Boolean(cleanValue(task.timeoutMs)) ||
      dependsOn.length > 0,
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

function parseQualityGates(
  value: NewRequirementDraft["qualityGates"],
): Array<{
  title: string;
  command: string;
  required: boolean;
  timeoutMs?: number | "invalid";
}> {
  if (Array.isArray(value)) {
    return value
      .map((gate) => {
        const command = cleanValue(gate.command);
        const timeoutMs = parseOptionalPositiveInteger(gate.timeoutMs);

        return {
          title: command,
          command,
          required: gate.required,
          timeoutMs,
        };
      })
      .filter(
        (gate) =>
          Boolean(gate.command) ||
          typeof gate.timeoutMs === "number" ||
          gate.timeoutMs === "invalid",
      )
      .map((gate) => ({
        title: gate.title,
        command: gate.command,
        required: gate.required,
        ...(gate.timeoutMs !== undefined ? { timeoutMs: gate.timeoutMs } : {}),
      }));
  }

  return parseList(value).map((line) => {
    const optionalMatch = line.match(/^optional\s*:\s*(?<command>.+)$/i);
    const requiredMatch = line.match(/^required\s*:\s*(?<command>.+)$/i);
    const command = cleanValue(
      optionalMatch?.groups?.command ?? requiredMatch?.groups?.command ?? line,
    );

    return {
      title: command,
      command,
      required: !optionalMatch,
    };
  });
}

function parseDependencyList(value: string): string[] {
  return value
    .split(/[\r\n,]+/)
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

function parseOptionalPositiveInteger(
  value: string,
): number | "invalid" | undefined {
  const normalized = cleanValue(value);

  if (!normalized) {
    return undefined;
  }

  const parsed = Number(normalized);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return "invalid";
  }

  return parsed;
}

function normalizeRiskLevel(value: string): NewRequirementRiskLevel | undefined {
  const normalized = value.trim().toLowerCase();

  return riskLevels.has(normalized as NewRequirementRiskLevel)
    ? (normalized as NewRequirementRiskLevel)
    : undefined;
}
