import { readFileSync } from "node:fs";
import path from "node:path";

/** The installed version of @krizaka/ui, read at build (server only): what this site runs on. Empty when it cannot be read. */
export function uiVersion(): string {
  try {
    return (JSON.parse(readFileSync(path.join(process.cwd(), "node_modules", "@krizaka", "ui", "package.json"), "utf8")) as { version: string }).version;
  } catch {
    return "";
  }
}
