import { defineConfig } from "tsup";

/** ESM + types, one entry. */
export default defineConfig({ entry: { index: "src/index.ts" }, format: ["esm"], dts: true, sourcemap: true, clean: false, target: "es2022" });
