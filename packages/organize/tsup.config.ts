import { defineConfig } from "tsup";

/** ESM + types: the server entry, the browser-safe contract, the store contract kit. */
export default defineConfig({ entry: { index: "src/index.ts", contract: "src/contract.ts", testkit: "src/testkit.ts" }, format: ["esm"], dts: true, sourcemap: true, clean: false, target: "es2022", external: ["vitest"] });
