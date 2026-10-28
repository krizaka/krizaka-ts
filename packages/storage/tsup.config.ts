import { defineConfig } from "tsup";

/** ESM + types: the library, its settings fragment, the admin-over-environment resolution and its contract kit. */
export default defineConfig({ entry: { index: "src/index.ts", node: "src/node.ts", settings: "src/settings.ts", resolve: "src/resolve.ts", "provider-admin": "src/provider-admin.ts", testkit: "src/testkit.ts" }, format: ["esm"], dts: true, sourcemap: true, clean: false, target: "es2022", external: ["vitest"] });
