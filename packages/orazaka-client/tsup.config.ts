import { defineConfig } from "tsup";

export default defineConfig({ entry: { index: "src/index.ts" }, format: ["esm"], dts: true, sourcemap: true, clean: false, target: "es2022" });
