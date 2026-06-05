import { randomUUID } from "node:crypto";
import {
  mkdirSync as defaultMkdirSync,
  renameSync as defaultRenameSync,
  unlinkSync as defaultUnlinkSync,
  writeFileSync as defaultWriteFileSync
} from "node:fs";
import { dirname } from "node:path";

export type AtomicJsonFileOptions = {
  maxRenameAttempts?: number;
  mkdirSync?: typeof defaultMkdirSync;
  randomSuffix?: () => string;
  renameSync?: typeof defaultRenameSync;
  sleepSync?: (ms: number) => void;
  unlinkSync?: typeof defaultUnlinkSync;
  writeFileSync?: typeof defaultWriteFileSync;
};

const retryableRenameErrors = new Set(["EACCES", "EBUSY", "EPERM"]);

export function writeJsonFileAtomically(
  path: string,
  value: unknown,
  options: AtomicJsonFileOptions = {}
): void {
  const mkdirSync = options.mkdirSync ?? defaultMkdirSync;
  const writeFileSync = options.writeFileSync ?? defaultWriteFileSync;
  const renameSync = options.renameSync ?? defaultRenameSync;
  const unlinkSync = options.unlinkSync ?? defaultUnlinkSync;
  const sleepSync = options.sleepSync ?? defaultSleepSync;
  const maxRenameAttempts = options.maxRenameAttempts ?? 5;
  const randomSuffix = options.randomSuffix ?? randomUUID;
  const tempFile = `${path}.${process.pid}.${randomSuffix()}.tmp`;

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(tempFile, JSON.stringify(value, null, 2), "utf8");

  try {
    renameWithRetry({
      from: tempFile,
      to: path,
      maxAttempts: maxRenameAttempts,
      renameSync,
      sleepSync
    });
  } catch (error) {
    try {
      unlinkSync(tempFile);
    } catch {
      // The rename may have partially succeeded or another process may already
      // have removed the temp file; the original error is more useful.
    }
    throw error;
  }
}

function renameWithRetry(input: {
  from: string;
  to: string;
  maxAttempts: number;
  renameSync: typeof defaultRenameSync;
  sleepSync: (ms: number) => void;
}): void {
  let lastError: unknown;

  for (let attempt = 1; attempt <= input.maxAttempts; attempt += 1) {
    try {
      input.renameSync(input.from, input.to);
      return;
    } catch (error) {
      lastError = error;

      if (!isRetryableRenameError(error) || attempt === input.maxAttempts) {
        throw error;
      }

      input.sleepSync(25 * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function isRetryableRenameError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    retryableRenameErrors.has(error.code)
  );
}

function defaultSleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
