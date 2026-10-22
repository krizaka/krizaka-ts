import { defineConfig } from "vitest/config";

/** The repository's own tests (scripts, workflows); each package has its own vitest config. */
export default defineConfig({ test: { include: ["scripts/**/*.test.mjs"], environment: "node" } });
