import { defineConfig } from "tsup";

/** ESM + types: the library and its store contract kit (`@krizaka/email-verification/testkit`). */
export default defineConfig({ entry: { index: "src/index.ts", testkit: "src/testkit.ts" }, format: ["esm"], dts: true, sourcemap: true, clean: false, target: "es2022", external: ["vitest"] });
