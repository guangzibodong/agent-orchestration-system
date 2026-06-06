import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildLaunchGateEvidence,
  buildLaunchGatePlan,
  formatLaunchGateCommand,
  renderLaunchGateMarkdown,
  summarizeCommandOutput,
  shouldUseShellForLaunchGateCommand,
  type LaunchGateCheck,
  type LaunchGateCheckResult,
  type LaunchGatePostgresMode,
} from "../packages/shared/src/launch-gate.js";

const root = resolve(".");
const outputDir = join(root, "output/launch-readiness");

function log(message: string) {
  console.log(`[launch:gate:local] ${message}`);
}

function npmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function parsePostgresMode(args: string[]): LaunchGatePostgresMode {
  const value = args
    .find((arg) => arg.startsWith("--postgres-mode="))
    ?.replace("--postgres-mode=", "");

  if (value === "required" || value === "disabled" || value === "auto") {
    return value;
  }

  return "auto";
}

function runGit(args: string[], fallback: string): string {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });

  if (result.status !== 0) {
    return fallback;
  }

  return result.stdout.trim() || fallback;
}

function readGitContext() {
  return {
    branch: runGit(["rev-parse", "--abbrev-ref", "HEAD"], "unknown"),
    commit: runGit(["rev-parse", "--short", "HEAD"], "unknown"),
    dirtyFiles: runGit(["status", "--short"], "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  };
}

function skippedResult(check: LaunchGateCheck): LaunchGateCheckResult {
  const status =
    check.execution === "not-applicable"
      ? "not-applicable"
      : "external-blocked";

  return {
    id: check.id,
    label: check.label,
    required: check.required,
    command: check.command,
    args: check.args,
    status,
    blockedReason: check.blockedReason,
    notApplicableReason: check.notApplicableReason,
  };
}

function runCheck(check: LaunchGateCheck): LaunchGateCheckResult {
  if (check.execution !== "run") {
    log(`${check.label}: ${check.execution}`);
    return skippedResult(check);
  }

  const startedAt = Date.now();
  log(`running ${check.command} ${check.args.join(" ")}`);
  const useShell = shouldUseShellForLaunchGateCommand(
    check.command,
    process.platform,
  );
  const result = spawnSync(
    useShell
      ? formatLaunchGateCommand(check.command, check.args)
      : check.command,
    useShell ? [] : check.args,
    {
      cwd: root,
      env: process.env,
      encoding: "utf8",
      maxBuffer: 30 * 1024 * 1024,
      shell: useShell,
      timeout: check.timeoutMs,
    },
  );
  const durationMs = Date.now() - startedAt;
  const exitCode = result.status ?? 1;
  const status = exitCode === 0 ? "passed" : "failed";

  if (result.error) {
    log(`${check.label}: failed (${result.error.message})`);
  } else {
    log(`${check.label}: ${status} (${durationMs} ms)`);
  }

  return {
    id: check.id,
    label: check.label,
    required: check.required,
    command: check.command,
    args: check.args,
    status,
    exitCode,
    durationMs,
    stdoutSummary: summarizeCommandOutput(result.stdout),
    stderrSummary: summarizeCommandOutput(
      result.error ? result.error.message : result.stderr,
    ),
  };
}

async function writeEvidenceFiles(
  evidence: ReturnType<typeof buildLaunchGateEvidence>,
): Promise<{ jsonPath: string; markdownPath: string }> {
  await mkdir(outputDir, { recursive: true });
  const stamp = evidence.generatedAt.replace(/[:.]/g, "-");
  const jsonPath = join(outputDir, `${stamp}.json`);
  const markdownPath = join(outputDir, `${stamp}.md`);

  await writeFile(jsonPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderLaunchGateMarkdown(evidence), "utf8");

  return { jsonPath, markdownPath };
}

export async function main() {
  const generatedAt = new Date().toISOString();
  const postgresMode = parsePostgresMode(process.argv.slice(2));
  const git = readGitContext();
  const plan = buildLaunchGatePlan({
    env: process.env,
    npmCommand: npmCommand(),
    postgresMode,
  });
  const checks = plan.map(runCheck);
  const evidence = buildLaunchGateEvidence({
    generatedAt,
    root,
    branch: git.branch,
    commit: git.commit,
    dirtyFiles: git.dirtyFiles,
    checks,
  });
  const files = await writeEvidenceFiles(evidence);

  log(`wrote ${files.jsonPath}`);
  log(`wrote ${files.markdownPath}`);
  log(`local decision: ${evidence.localDecision}`);
  log(`production decision: ${evidence.productionDecision}`);

  if (evidence.productionDecision === "blocked") {
    log(
      "production blockers are recorded in evidence; local exit code only reflects required local checks.",
    );
  }

  process.exitCode = evidence.localDecision === "passed" ? 0 : 1;
}

function isDirectRun(): boolean {
  const entry = process.argv[1];

  return (
    process.env.MAWO_LAUNCH_GATE_ENTRY === "1" ||
    Boolean(entry && pathToFileURL(resolve(entry)).href === import.meta.url)
  );
}

if (isDirectRun()) {
  main().catch((error: unknown) => {
    console.error("[launch:gate:local] failed");
    console.error(error);
    process.exitCode = 1;
  });
}
