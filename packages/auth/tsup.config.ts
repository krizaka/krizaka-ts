import { defineConfig } from "tsup";

/** ESM + types: the library and its contract kit (`@krizaka/auth/testkit`: identity providers and link stores). */
export default defineConfig({ entry: { index: "src/index.ts", testkit: "src/testkit.ts" }, format: ["esm"], dts: true, sourcemap: true, clean: false, target: "es2022", external: ["vitest"] });
