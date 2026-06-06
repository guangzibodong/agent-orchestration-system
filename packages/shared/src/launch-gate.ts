export type LaunchGatePostgresMode = "auto" | "required" | "disabled";

export type LaunchGateExecution =
  | "run"
  | "external-blocked"
  | "not-applicable";

export type LaunchGateStatus =
  | "passed"
  | "failed"
  | "external-blocked"
  | "not-applicable";

export type LaunchGateCheck = {
  id: string;
  label: string;
  required: boolean;
  command: string;
  args: string[];
  execution: LaunchGateExecution;
  timeoutMs?: number;
  blockedReason?: string;
  notApplicableReason?: string;
};

export type LaunchGateCheckResult = {
  id: string;
  label: string;
  required: boolean;
  command: string;
  args: string[];
  status: LaunchGateStatus;
  exitCode?: number;
  durationMs?: number;
  stdoutSummary?: string;
  stderrSummary?: string;
  blockedReason?: string;
  notApplicableReason?: string;
};

export type BuildLaunchGatePlanInput = {
  env?: Record<string, string | undefined>;
  npmCommand?: string;
  postgresMode?: LaunchGatePostgresMode;
};

export type BuildLaunchGateEvidenceInput = {
  generatedAt: string;
  root: string;
  branch: string;
  commit: string;
  dirtyFiles: string[];
  checks: LaunchGateCheckResult[];
};

export type LaunchGateEvidence = BuildLaunchGateEvidenceInput & {
  docs: string[];
  localDecision: "passed" | "failed";
  productionDecision: "ready" | "blocked";
  failureSummaries: string[];
  externalBlockers: string[];
};

const frozenLocalChecks = [
  ["env", "Environment check", "env"],
  ["typecheck", "Typecheck", "typecheck"],
  ["lint", "Lint", "lint"],
  ["test", "Test", "test"],
  ["build", "Build", "build"],
  ["smoke_ui", "UI smoke", "smoke:ui"],
  ["smoke_api", "API smoke", "smoke:api"],
  ["smoke_api_requirements", "Requirement API smoke", "smoke:api:requirements"],
  ["smoke_backup_restore", "Backup restore smoke", "smoke:backup:restore"],
  [
    "smoke_production_readiness",
    "Production readiness smoke",
    "smoke:readiness:production",
  ],
] as const;

const postgresChecks = [
  ["db_validate", "Postgres schema validation", "db:validate"],
  ["db_migrate_deploy", "Postgres migration deploy", "db:migrate:deploy"],
  ["smoke_api_postgres", "Postgres API smoke", "smoke:api:postgres"],
] as const;

const launchGateDocs = [
  "docs/LAUNCH_READINESS_EVIDENCE.md",
  "docs/OPERATIONS.md#11-known-limits",
  "docs/product/REQUIREMENTS_FREEZE.md",
];

function npmRunCheck(
  id: string,
  label: string,
  script: string,
  npmCommand: string,
  required: boolean,
): LaunchGateCheck {
  return {
    id,
    label,
    required,
    command: npmCommand,
    args: ["run", script],
    execution: "run",
  };
}

export function buildLaunchGatePlan(
  input: BuildLaunchGatePlanInput = {},
): LaunchGateCheck[] {
  const env = input.env ?? {};
  const npmCommand = input.npmCommand ?? "npm";
  const postgresMode = input.postgresMode ?? "auto";
  const localChecks = [
    npmRunCheck("env", "Environment check", "env", npmCommand, true),
    {
      id: "git_diff_check",
      label: "Git diff whitespace check",
      required: true,
      command: "git",
      args: ["diff", "--check"],
      execution: "run" as const,
    },
    ...frozenLocalChecks
      .filter(([id]) => id !== "env")
      .map(([id, label, script]) =>
        npmRunCheck(id, label, script, npmCommand, true),
      ),
  ];

  if (postgresMode === "disabled") {
    return [
      ...localChecks,
      ...postgresChecks.map(([id, label, script]) => ({
        ...npmRunCheck(id, label, script, npmCommand, false),
        execution: "not-applicable" as const,
        notApplicableReason: "Postgres launch mode is disabled for this target.",
      })),
    ];
  }

  if (!env.DATABASE_URL) {
    return [
      ...localChecks,
      ...postgresChecks.map(([id, label, script]) => ({
        ...npmRunCheck(
          id,
          label,
          script,
          npmCommand,
          postgresMode === "required",
        ),
        execution: "external-blocked" as const,
        blockedReason:
          "DATABASE_URL is not configured for Postgres launch verification.",
      })),
    ];
  }

  return [
    ...localChecks,
    ...postgresChecks.map(([id, label, script]) =>
      npmRunCheck(id, label, script, npmCommand, postgresMode === "required"),
    ),
  ];
}

export function formatLaunchGateCommand(
  command: string,
  args: string[],
): string {
  return [command, ...args].join(" ");
}

export function summarizeCommandOutput(
  value: string | undefined,
  maxLength = 1200,
): string {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
}

export function shouldUseShellForLaunchGateCommand(
  command: string,
  platform: string,
): boolean {
  return platform === "win32" && /\.(?:cmd|bat)$/i.test(command);
}

export function buildLaunchGateEvidence(
  input: BuildLaunchGateEvidenceInput,
): LaunchGateEvidence {
  const failureSummaries = input.checks
    .filter((check) => check.status === "failed")
    .map((check) => {
      const summary =
        check.stderrSummary || check.stdoutSummary || "no output captured";
      const exitCode =
        typeof check.exitCode === "number" ? String(check.exitCode) : "unknown";

      return `${check.id} failed with exit code ${exitCode}: ${summary}`;
    });
  const externalBlockers = input.checks
    .filter((check) => check.status === "external-blocked")
    .map(
      (check) =>
        `${check.id}: ${check.blockedReason ?? "External dependency unavailable."}`,
    );
  const hasRequiredBlockingCheck = input.checks.some(
    (check) =>
      check.required &&
      (check.status === "failed" || check.status === "external-blocked"),
  );
  const localDecision = hasRequiredBlockingCheck ? "failed" : "passed";
  const productionDecision =
    failureSummaries.length > 0 || externalBlockers.length > 0
      ? "blocked"
      : "ready";

  return {
    ...input,
    docs: [...launchGateDocs],
    localDecision,
    productionDecision,
    failureSummaries,
    externalBlockers,
  };
}

function tableValue(value: string | number | undefined): string {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export function renderLaunchGateMarkdown(evidence: LaunchGateEvidence): string {
  const dirtyFiles =
    evidence.dirtyFiles.length > 0
      ? evidence.dirtyFiles.map((file) => `- ${file}`).join("\n")
      : "- none";
  const failureSummaries =
    evidence.failureSummaries.length > 0
      ? evidence.failureSummaries.map((summary) => `- ${summary}`).join("\n")
      : "- none";
  const externalBlockers =
    evidence.externalBlockers.length > 0
      ? evidence.externalBlockers.map((summary) => `- ${summary}`).join("\n")
      : "- none";
  const rows = evidence.checks
    .map(
      (check) =>
        `| ${tableValue(check.label)} | ${tableValue(check.status)} | ${tableValue(
          check.exitCode,
        )} | ${tableValue(check.durationMs)} | ${tableValue(
          formatLaunchGateCommand(check.command, check.args),
        )} |`,
    )
    .join("\n");

  return [
    "# Local Launch Gate Evidence",
    "",
    `- Generated at: ${evidence.generatedAt}`,
    `- Root: ${evidence.root}`,
    `- Branch: ${evidence.branch}`,
    `- Commit: ${evidence.commit}`,
    `- Local decision: ${evidence.localDecision}`,
    `- Production decision: ${evidence.productionDecision}`,
    "",
    "## Frozen References",
    ...evidence.docs.map((doc) => `- ${doc}`),
    "",
    "## Dirty Files",
    dirtyFiles,
    "",
    "## Checks",
    "| Check | Status | Exit | Duration ms | Command |",
    "| --- | --- | --- | --- | --- |",
    rows,
    "",
    "## Failure Summaries",
    failureSummaries,
    "",
    "## External Blockers",
    externalBlockers,
    "",
  ].join("\n");
}
