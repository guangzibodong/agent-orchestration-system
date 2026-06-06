import { describe, expect, it } from "vitest";
import config from "../../../playwright.config";

describe("playwright config", () => {
  it("uses a cross-platform web server command for CI", () => {
    const webServer = Array.isArray(config.webServer)
      ? config.webServer[0]
      : config.webServer;

    expect(webServer?.command).toBe("npm run dev:web");
    expect(webServer?.command).not.toContain("npm.cmd");
    expect(webServer?.command).not.toContain("\\");
  });
});
