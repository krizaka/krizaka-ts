import { defineConfig } from "tsup";

/** ESM + types: the library, its contract kit (`@krizaka/auth/testkit`: identity providers, link and session stores), the browser-safe `/api/me` contract (`./contract`) and the settings fragment (`./settings`). */
export default defineConfig({ entry: { index: "src/index.ts", testkit: "src/testkit.ts", contract: "src/contract.ts", settings: "src/settings.ts", client: "src/client.ts" }, format: ["esm"], dts: true, sourcemap: true, clean: false, target: "es2022", external: ["vitest"] });
