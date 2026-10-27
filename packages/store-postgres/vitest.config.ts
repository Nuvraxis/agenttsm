import { defineConfig, type ViteUserConfig } from "vitest/config";

// Load @nuvraxis-org/agenttsm from source, as the shared conformance runner does, so both see
// one copy of the core module.
const conditions = ["@nuvraxis-org/source"];

const config: ViteUserConfig = defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "lcov"],
      // Without DATABASE_URL the database tests skip, so only CI (which sets it) enforces coverage.
      thresholds: process.env.DATABASE_URL
        ? { lines: 90, functions: 90, branches: 90, statements: 90 }
        : {},
    },
  },
});

export default config;
