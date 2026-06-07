import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: {
    jsx: {
      runtime: "automatic",
      importSource: "react",
    },
  },
  test: {
    environment: "node",
    hookTimeout: 15_000,
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    testTimeout: 15_000,
  },
});
