import { spawn, spawnSync } from "node:child_process";

export type ShellRunStatus = "passed" | "failed" | "canceled";

export type ShellRunInput = {
  command: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type ShellRunResult = {
  command: string;
  status: ShellRunStatus;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  startedAt: string;
  finishedAt: string;
  metadata?: Record<string, string>;
};

export class ShellAdapter {
  async run(input: ShellRunInput): Promise<ShellRunResult> {
    const started = Date.now();
    const startedAt = new Date(started).toISOString();

    return new Promise((resolve, reject) => {
      let settled = false;
      let timedOut = false;
      let canceled = input.signal?.aborted ?? false;
      const child = spawn(input.command, {
        cwd: input.cwd,
        env: {
          ...process.env,
          ...input.env
        },
        detached: process.platform !== "win32",
        shell: true,
        windowsHide: true
      });

      let stdout = "";
      let stderr = "";

      const appendStderr = (message: string) => {
        stderr += `${stderr.endsWith("\n") || stderr.length === 0 ? "" : "\n"}${message}`;
      };

      const cancel = () => {
        if (settled || canceled) {
          return;
        }
        canceled = true;
        appendStderr("Command canceled.");
        killProcessTree(child.pid);
      };

      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      const timeout =
        input.timeoutMs && input.timeoutMs > 0
          ? setTimeout(() => {
              timedOut = true;
              appendStderr(`Command timed out after ${input.timeoutMs}ms.`);
              killProcessTree(child.pid);
            }, input.timeoutMs)
          : undefined;

      input.signal?.addEventListener("abort", cancel, { once: true });

      if (input.signal?.aborted) {
        cancel();
      }

      const cleanup = () => {
        if (timeout) {
          clearTimeout(timeout);
        }
        input.signal?.removeEventListener("abort", cancel);
      };

      child.on("error", (error) => {
        cleanup();
        if (!settled) {
          settled = true;
          reject(error);
        }
      });

      child.on("close", (code) => {
        cleanup();
        if (settled) {
          return;
        }
        settled = true;
        const finished = Date.now();
        const exitCode = code ?? 1;

        resolve({
          command: input.command,
          status: canceled ? "canceled" : exitCode === 0 ? "passed" : "failed",
          exitCode,
          stdout,
          stderr,
          durationMs: finished - started,
          startedAt,
          finishedAt: new Date(finished).toISOString(),
          metadata: canceled
            ? {
                canceled: "true"
              }
            : timedOut
            ? {
                timedOut: "true"
              }
            : undefined
        });
      });
    });
  }
}

function killProcessTree(pid?: number): void {
  if (!pid) {
    return;
  }

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], {
      windowsHide: true
    });
    return;
  }

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // The process may already have exited.
    }
  }
}
