#!/usr/bin/env node
/* Files are named by what they do, never by the technology behind them (Oussama, 2026-10-22): `accounts.ts`, `persistence.ts`,
   `db.ts` — not `postgres.ts`, `pg-store.ts`, `mailgun.ts`. A technology changes; the function of the file does not. The
   technology goes inside the file (an adapter's comment, a parameter), never in its name.
     node scripts/check-file-names.mjs        exits 1 and lists every file whose name is a technology */
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/** Technologies and vendors a file name must not carry (a whole word of the name, so `pagination.ts` is fine). */
export const TECHNOLOGIES = [
  "postgres",
  "postgresql",
  "pg",
  "mysql",
  "mariadb",
  "sqlite",
  "redis",
  "mongo",
  "mongodb",
  "drizzle",
  "prisma",
  "knex",
  "mailgun",
  "sendgrid",
  "resend",
  "stripe",
  "twilio",
  "bunny",
  "s3",
  "ollama",
  "openai",
  "anthropic",
  "kafka",
  "rabbitmq",
  "amqp",
];

const SKIP = new Set(["node_modules", "dist", ".git", ".turbo", "coverage"]);

/** The words of a file name: `pg-store.integration.test.ts` → pg, store, integration, test, ts. */
const words = (name) =>
  name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** Whether a file name carries a technology as one of its words. */
export const isTechnologyName = (name) => words(name).some((w) => TECHNOLOGIES.includes(w));

export function technologyNamedFiles(root) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx|mts|mjs|js|sql)$/.test(entry.name) && isTechnologyName(entry.name))
        found.push(relative(root, path));
    }
  };
  walk(join(root, "packages"));
  return found.sort((a, b) => a.localeCompare(b));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
  const bad = technologyNamedFiles(root);
  if (bad.length) {
    console.error(
      `check-file-names: name these files by what they do, not by their technology:\n${bad.map((f) => `  ${f}`).join("\n")}`,
    );
    process.exit(1);
  }
  console.log("check-file-names: ok");
}
