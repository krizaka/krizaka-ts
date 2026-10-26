// Writes the files that are published, from the built module: dist/org.json, dist/org.schema.json, dist/app.schema.json, dist/apps/<product>.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(fileURLToPath(new URL("..", import.meta.url)), "dist");
const { org, apps, orgSchema, appSchema } = await import(join(dist, "index.js"));

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
mkdirSync(join(dist, "apps"), { recursive: true });
writeFileSync(join(dist, "org.json"), json(org));
writeFileSync(join(dist, "org.schema.json"), json(orgSchema));
writeFileSync(join(dist, "app.schema.json"), json(appSchema));
for (const [id, config] of Object.entries(apps)) writeFileSync(join(dist, "apps", `${id}.json`), json(config));
