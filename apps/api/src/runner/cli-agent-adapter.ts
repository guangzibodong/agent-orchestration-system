import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ShellAdapter, type ShellRunResult } from "./shell-adapter.js";

export type CliAgentConfig = {
  id: string;
  label: string;
  commandTemplate: string;
  env?: NodeJS.ProcessEnv;
};

export type CliAgentRunInput = {
  workspace: string;
  goal: string;
  instructions: string;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export class CliAgentAdapter {
  private readonly shell: ShellAdapter;
  readonly config: CliAgentConfig;

  constructor(config: CliAgentConfig, shell = new ShellAdapter()) {
    this.config = config;
    this.shell = shell;
  }

  async run(input: CliAgentRunInput): Promise<ShellRunResult> {
    const promptDir = await mkdtemp(join(tmpdir(), "mawo-agent-prompt-"));
    const promptFile = join(promptDir, `${this.config.id}.prompt.cjs`);
    await writeFile(promptFile, buildPrompt(input), "utf8");

    const command = renderTemplate(this.config.commandTemplate, {
      promptFile,
      workspace: input.workspace,
      goal: input.goal
    });
    const result = await this.shell.run({
      command,
      cwd: input.workspace,
      env: this.config.env,
      timeoutMs: input.timeoutMs,
      signal: input.signal
    });

    return {
      ...result,
      metadata: {
        ...result.metadata,
        agentId: this.config.id,
        agentLabel: this.config.label,
        promptFile
      }
    };
  }
}

function buildPrompt(input: CliAgentRunInput): string {
  return [
    `// Goal: ${input.goal}`,
    `// Workspace: ${input.workspace}`,
    input.instructions,
    ""
  ].join("\n");
}

function renderTemplate(
  template: string,
  values: Record<string, string>
): string {
  return template.replace(/\{(promptFile|workspace|goal)\}/g, (_match, key) =>
    quote(values[key] ?? "")
  );
}

function quote(value: string): string {
  return JSON.stringify(value);
}
