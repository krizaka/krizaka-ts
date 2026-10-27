import { defineConfig } from "tsup";

/** ESM + types: the library, its settings fragment and its contract kit. */
export default defineConfig({ entry: { index: "src/index.ts", settings: "src/settings.ts", testkit: "src/testkit.ts" }, format: ["esm"], dts: true, sourcemap: true, clean: false, target: "es2022", external: ["vitest"] });
