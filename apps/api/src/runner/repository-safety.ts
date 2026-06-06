import { spawnSync } from "node:child_process";
import { resolve, sep } from "node:path";
import {
  repositorySafetySchema,
  type RepositoryRecord,
  type RepositorySafety,
} from "@mawo/shared";

const MANUAL_APPLY_POLICY =
  "Manual review is required; MAWO never automatically merges repository changes.";

export type GitCommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

export type GitCommandRunner = (
  args: string[],
  cwd: string,
) => GitCommandResult;

export type RepositorySafetyInspectorInput = {
  repository: RepositoryRecord;
  allowedRoots: string[];
  runGit?: GitCommandRunner;
};

export type RepositorySafetyInspector = (input: {
  repository: RepositoryRecord;
  allowedRoots: string[];
}) => RepositorySafety | Promise<RepositorySafety>;

export function inspectRepositorySafety(
  input: RepositorySafetyInspectorInput,
): RepositorySafety {
  const repositoryPath = resolve(input.repository.path);
  const allowedRoot = isRepositoryPathAllowed(
    repositoryPath,
    input.allowedRoots,
  );
  const base = {
    repositoryId: input.repository.id,
    path: repositoryPath,
    defaultBranch: input.repository.defaultBranch,
    clean: false,
    dirty: false,
    allowedRoot,
    noAutoMerge: true,
    manualApplyPolicy: MANUAL_APPLY_POLICY,
  };

  if (!allowedRoot) {
    return repositorySafetySchema.parse({
      ...base,
      blockedReason: "repository_path_not_allowed",
      recoveryAction:
        "Move the repository under MAWO_ALLOWED_REPOSITORY_ROOTS or update MAWO_ALLOWED_REPOSITORY_ROOTS.",
    });
  }

  const runGit = input.runGit ?? runGitCommand;
  const gitRoot = runGit(["rev-parse", "--show-toplevel"], repositoryPath);

  if (gitRoot.status !== 0) {
    return repositorySafetySchema.parse({
      ...base,
      blockedReason: "git_repository_required",
      recoveryAction: "Choose a path inside a git repository.",
    });
  }

  const head = runGit(["rev-parse", "--verify", "HEAD"], repositoryPath);

  if (head.status !== 0) {
    return repositorySafetySchema.parse({
      ...base,
      currentBranch: readGitValue(
        runGit(["rev-parse", "--abbrev-ref", "HEAD"], repositoryPath),
      ),
      blockedReason: "committed_head_required",
      recoveryAction:
        "Create the repository's first commit before running mutating workflows.",
    });
  }

  const currentBranch = readGitValue(
    runGit(["rev-parse", "--abbrev-ref", "HEAD"], repositoryPath),
  );
  const headShortSha = readGitValue(
    runGit(["rev-parse", "--short", "HEAD"], repositoryPath),
  );
  const status = runGit(["status", "--short"], repositoryPath);

  if (status.status !== 0) {
    return repositorySafetySchema.parse({
      ...base,
      currentBranch,
      headShortSha,
      blockedReason: "git_status_unavailable",
      recoveryAction:
        "Resolve the git status error before running mutating workflows.",
    });
  }

  const dirty = status.stdout.trim().length > 0;

  return repositorySafetySchema.parse({
    ...base,
    currentBranch,
    headShortSha,
    clean: !dirty,
    dirty,
    ...(dirty
      ? {
          blockedReason: "repository_dirty",
          recoveryAction:
            "Commit, stash, or discard local changes before running mutating workflows.",
        }
      : {}),
  });
}

function runGitCommand(args: string[], cwd: string): GitCommandResult {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr:
      result.stderr ??
      (result.error instanceof Error ? result.error.message : ""),
  };
}

function readGitValue(result: GitCommandResult): string | undefined {
  if (result.status !== 0) {
    return undefined;
  }

  const value = result.stdout.trim();
  return value || undefined;
}

function isRepositoryPathAllowed(
  path: string,
  allowedRoots: string[],
): boolean {
  if (allowedRoots.length === 0) {
    return true;
  }

  const candidate = resolve(path);

  return allowedRoots.some((root) => {
    const normalizedRoot = resolve(root);
    return (
      candidate === normalizedRoot ||
      candidate.startsWith(`${normalizedRoot}${sep}`)
    );
  });
}
