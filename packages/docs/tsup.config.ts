import { defineConfig } from "tsup";

/** ESM + types. `./extract` keeps `typescript` external: the product's own compiler reads its own program. */
export default defineConfig({
  entry: { index: "src/index.ts", extract: "src/extract.ts" },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: false,
  target: "es2022",
  external: ["typescript"],
});
