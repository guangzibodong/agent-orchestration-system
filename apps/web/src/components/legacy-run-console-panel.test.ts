import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LegacyRunConsolePanel } from "./legacy-run-console-panel";

vi.mock("./run-console", () => ({
  RunConsole: () => createElement("div", null, "Run Workflow")
}));

describe("LegacyRunConsolePanel", () => {
  it("keeps legacy run controls out of server-rendered markup", () => {
    const html = renderToStaticMarkup(createElement(LegacyRunConsolePanel));

    expect(html).toContain("Legacy Run Console");
    expect(html).toContain("Secondary ops/debug");
    expect(html).toContain('aria-label="Legacy Run Console secondary ops/debug"');
    expect(html).toContain('id="legacy-run-console"');
    expect(html).toContain('class="legacyConsoleHydrationSlot"');
    expect(html).not.toContain("API token");
    expect(html).not.toContain("Run Workflow");
    expect(html).not.toContain("Register Repository");
  });
});
