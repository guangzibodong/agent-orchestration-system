import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("deployment manifests", () => {
  it("provides a production Dockerfile for API and web targets", () => {
    const dockerfile = read("Dockerfile");

    expect(dockerfile).toContain("AS api");
    expect(dockerfile).toContain("AS web");
    expect(dockerfile).toContain("npm run build");
    expect(dockerfile).toContain("npm run start -w @mawo/api");
    expect(dockerfile).toContain("npm run start -w @mawo/web");
  });

  it("runs API, web, and runtime state through docker compose", () => {
    const compose = read("docker-compose.yml");

    expect(compose).toContain("api:");
    expect(compose).toContain("web:");
    expect(compose).toContain("target: api");
    expect(compose).toContain("target: web");
    expect(compose).toContain("API_HOST: 0.0.0.0");
    expect(compose).toContain("NEXT_PUBLIC_API_URL:");
    expect(compose).toContain("mawo_state:");
  });

  it("documents deploy-time environment variables", () => {
    const env = read(".env.example");

    expect(env).toContain("API_HOST=0.0.0.0");
    expect(env).toContain("API_PORT=4000");
    expect(env).toContain("NEXT_PUBLIC_API_URL=http://127.0.0.1:4000");
    expect(env).toContain("MAWO_CODEX_COMMAND_TEMPLATE=");
  });
});
