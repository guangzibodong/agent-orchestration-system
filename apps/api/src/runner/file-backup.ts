import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { dirname, join } from "node:path";

export type FileStateBackupManifest = {
  backupPath: string;
  byteCount: number;
  createdAt: string;
  fileCount: number;
  kind: "mawo-file-state";
  source: string;
  version: 1;
};

export type CreateFileStateBackupInput = {
  backupRoot: string;
  name?: string;
  now?: Date;
  sourceDir: string;
};

export type RestoreFileStateBackupInput = {
  backupPath: string;
  targetDir: string;
};

const manifestFileName = "mawo-backup-manifest.json";
const backupStateDirName = ".mawo";

export async function createFileStateBackup(
  input: CreateFileStateBackupInput
): Promise<FileStateBackupManifest> {
  await assertDirectory(input.sourceDir, "Backup source");
  const now = input.now ?? new Date();
  const backupPath = join(
    input.backupRoot,
    input.name ?? `mawo-${formatBackupStamp(now)}`
  );
  const backupStateDir = join(backupPath, backupStateDirName);

  await mkdir(input.backupRoot, { recursive: true });
  await mkdir(backupPath);
  await cp(input.sourceDir, backupStateDir, { recursive: true });

  const totals = await summarizeDirectory(backupStateDir);
  const manifest: FileStateBackupManifest = {
    backupPath,
    byteCount: totals.byteCount,
    createdAt: now.toISOString(),
    fileCount: totals.fileCount,
    kind: "mawo-file-state",
    source: input.sourceDir,
    version: 1
  };

  await writeFile(
    join(backupPath, manifestFileName),
    JSON.stringify(manifest, null, 2),
    "utf8"
  );

  return manifest;
}

export async function restoreFileStateBackup(
  input: RestoreFileStateBackupInput
): Promise<FileStateBackupManifest> {
  const manifest = await readFileStateBackupManifest(input.backupPath);
  const backupStateDir = join(input.backupPath, backupStateDirName);
  await assertDirectory(backupStateDir, "Backup state");
  await rm(input.targetDir, { recursive: true, force: true });
  await mkdir(dirname(input.targetDir), { recursive: true });
  await cp(backupStateDir, input.targetDir, { recursive: true });

  return manifest;
}

export async function readFileStateBackupManifest(
  backupPath: string
): Promise<FileStateBackupManifest> {
  const parsed = JSON.parse(
    await readFile(join(backupPath, manifestFileName), "utf8")
  ) as unknown;

  if (!isFileStateBackupManifest(parsed)) {
    throw new Error("Backup manifest is invalid.");
  }

  return parsed;
}

async function assertDirectory(path: string, label: string): Promise<void> {
  const info = await stat(path);

  if (!info.isDirectory()) {
    throw new Error(`${label} must be a directory: ${path}`);
  }
}

async function summarizeDirectory(
  path: string
): Promise<{ byteCount: number; fileCount: number }> {
  const entries = await readdir(path, { withFileTypes: true });
  let byteCount = 0;
  let fileCount = 0;

  for (const entry of entries) {
    const entryPath = join(path, entry.name);

    if (entry.isDirectory()) {
      const child = await summarizeDirectory(entryPath);
      byteCount += child.byteCount;
      fileCount += child.fileCount;
      continue;
    }

    const info = await stat(entryPath);
    byteCount += info.size;
    fileCount += 1;
  }

  return { byteCount, fileCount };
}

function formatBackupStamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function isFileStateBackupManifest(
  value: unknown
): value is FileStateBackupManifest {
  if (!value || typeof value !== "object") {
    return false;
  }

  const manifest = value as Partial<FileStateBackupManifest>;

  return (
    manifest.kind === "mawo-file-state" &&
    manifest.version === 1 &&
    typeof manifest.backupPath === "string" &&
    typeof manifest.byteCount === "number" &&
    typeof manifest.createdAt === "string" &&
    typeof manifest.fileCount === "number" &&
    typeof manifest.source === "string"
  );
}
