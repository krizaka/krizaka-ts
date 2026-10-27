import { defineConfig } from "vitest/config";

// The concurrency tests run their scenario in a loop against PostgreSQL: a loaded CI runner needs more than the default 5 seconds.
export default defineConfig({ test: { include: ["test/**/*.test.ts"], environment: "node", testTimeout: 60_000 } });
