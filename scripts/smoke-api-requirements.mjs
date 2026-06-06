import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pathParts = [];
const nodeDir = join(root, ".tools", "node");
const gitDir = join(root, ".tools", "git", "cmd");

if (existsSync(nodeDir)) {
  pathParts.push(nodeDir);
}

if (existsSync(gitDir)) {
  pathParts.push(gitDir);
}

const env = {
  ...process.env,
  PATH: [...pathParts, process.env.PATH ?? ""].filter(Boolean).join(delimiter),
};
const tsxCli = join(root, "node_modules", "tsx", "dist", "cli.mjs");

if (!existsSync(tsxCli)) {
  console.error(
    "[smoke:api:requirements] Missing local tsx CLI. Run npm install before smoke testing.",
  );
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [tsxCli, "scripts/smoke-api-requirements.ts"],
  {
    cwd: root,
    env,
    stdio: "inherit",
  },
);

if (result.error) {
  console.error(result.error);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
