import { defineConfig } from "tsup";

/** ESM + types: the library and its store contract kit (`@krizaka/rate-limit/testkit`; the registry fragment is `@krizaka/rate-limit/settings`). */
export default defineConfig({ entry: { index: "src/index.ts", settings: "src/settings.ts", testkit: "src/testkit.ts" }, format: ["esm"], dts: true, sourcemap: true, clean: false, target: "es2022", external: ["vitest"] });
