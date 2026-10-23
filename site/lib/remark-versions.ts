/* Replaces the version tokens of a page — `%@krizaka/auth%` (a package name between percent signs) — by the version npm lists
   (lib/packages.ts), in text, inline code and code blocks. An unknown token fails the build: a page never states a version
   nobody read. */

import type { Root } from "mdast";
import { packages } from "./packages.ts";

const TOKEN = /%(@krizaka\/[a-z0-9-]+)%/g;

function replace(value: string, versions: Record<string, string | null>, where: string): string {
  return value.replace(TOKEN, (whole, name: string) => {
    const version = versions[name];
    if (!version) throw new Error(`${where}: ${whole} — npm lists no ${name}`);
    return version;
  });
}

export function remarkVersions() {
  return (tree: Root, file: { path?: string }) => {
    const versions = Object.fromEntries(packages().map((p) => [p.name, p.version]));
    const visit = (node: { type: string; value?: string; children?: unknown[] }) => {
      if (typeof node.value === "string" && ["text", "inlineCode", "code"].includes(node.type)) node.value = replace(node.value, versions, file.path ?? "page");
      for (const child of node.children ?? []) visit(child as never);
    };
    visit(tree as never);
  };
}
