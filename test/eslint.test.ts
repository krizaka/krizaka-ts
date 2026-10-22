import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ESLint, type Linter } from "eslint";
import tseslint from "typescript-eslint";

import { envNamePrefixProblem, envNames, ownProductPrefix } from "../eslint/env-names.js";
import { krizakaBase } from "../eslint/index.js";
import { krizakaUi, krizakaUiRestrictedSyntax, krizakaUiRules } from "../eslint/krizaka-ui.js";
import { krizakaNext } from "../eslint/next.js";
import { LOCALE_TERNARY_SELECTORS, noLocaleTernary } from "../eslint/no-locale-ternary.js";
import { krizakaStack, STACK_RULES } from "../eslint/stack.js";
import { krizakaUiWarnings, UI_WARNING_RULES } from "../eslint/ui-warnings.js";

const TSX = { files: ["**/*.{ts,tsx}"], languageOptions: { parser: tseslint.parser } } satisfies Linter.Config;

async function lint(config: Linter.Config[], code: string, filePath = "components/card.tsx") {
  const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: [TSX, ...config], cwd: process.cwd() });
  const [result] = await eslint.lintText(code, { filePath });
  return result!.messages;
}
const ids = (messages: Linter.LintMessage[]) => messages.map((m) => m.ruleId);

describe("krizakaUi — the four rules of §2.12", () => {
  it("refuses a raw palette colour", async () => {
    const messages = await lint(krizakaUi(), `export const A = () => <div className="p-2 bg-zinc-900/60" />;`);
    expect(ids(messages)).toEqual(["no-restricted-syntax"]);
    expect(messages[0]!.message).toMatch(/palette/);
  });

  it("refuses `light:`", async () => {
    const messages = await lint(krizakaUi(), `export const A = () => <div className="light:bg-surface-1" />;`);
    expect(messages[0]!.message).toMatch(/light:/);
  });

  it("refuses an arbitrary [var(--…)] utility", async () => {
    const messages = await lint(krizakaUi(), `export const A = () => <div className="bg-[var(--surface-1)]" />;`);
    expect(messages[0]!.message).toMatch(/Arbitrary utility/);
  });

  it("refuses a template literal in className, even inside a call", async () => {
    const code = "export const A = ({ c }: { c: string }) => <><div className={`p-2 ${c}`} /><i className={cn(`a`, c)} /></>;";
    const messages = await lint(krizakaUi(), code);
    expect(messages).toHaveLength(2);
    expect(messages.every((m) => /template string/.test(m.message))).toBe(true);
  });

  it("reaches literals nested in cn() and ternaries", async () => {
    const code = `export const A = ({ on }: { on: boolean }) => <div className={cn("p-2", on ? "text-violet-400" : "text-fg")} />;`;
    expect(await lint(krizakaUi(), code)).toHaveLength(1);
  });

  it("accepts roles and classes outside className", async () => {
    const code = `const tone = "bg-zinc-900"; export const A = () => <div data-tone={tone} className="bg-surface-1 text-fg-secondary border-border-default text-accent" />;`;
    expect(await lint(krizakaUi(), code)).toEqual([]);
  });

  it("takes an allowlist of families", async () => {
    const code = `export const A = () => <div className="bg-emerald-600/90 text-rose-300" />;`;
    expect(await lint(krizakaUi({ allow: ["emerald"] }), code)).toHaveLength(1);
    expect(await lint(krizakaUi({ allow: ["emerald", "rose"] }), code)).toEqual([]);
  });

  it("takes files, ignores and severity", async () => {
    const code = `export const A = () => <div className="bg-zinc-900" />;`;
    expect(await lint(krizakaUi({ files: ["src/**/*.tsx"] }), code)).toEqual([]);
    expect(await lint(krizakaUi({ ignores: ["components/**"] }), code)).toEqual([]);
    expect((await lint(krizakaUi({ severity: "warn" }), code))[0]!.severity).toBe(1);
  });

  it("exposes exactly four selectors, also as a rule set", () => {
    expect(krizakaUiRestrictedSyntax()).toHaveLength(4);
    expect(krizakaUiRules["no-restricted-syntax"]).toHaveLength(5);
  });
});

describe("noLocaleTernary", () => {
  it("refuses a locale ternary in a component", async () => {
    const code = `export const label = (locale: string, isFr: boolean) => [locale === "fr" ? "Bonjour" : "Hello", isFr ? "a" : "b"];`;
    const messages = await lint(noLocaleTernary(), code);
    expect(ids(messages)).toEqual(["krizaka/no-locale-ternary", "krizaka/no-locale-ternary"]);
  });

  it("allows routing code", async () => {
    const code = `export const pick = (locale: string) => (locale === "en" ? "/en" : "/fr");`;
    expect(await lint(noLocaleTernary(), code, "lib/i18n.ts")).toEqual([]);
    expect(await lint(noLocaleTernary(), code, "proxy.ts")).toEqual([]);
    expect(await lint(noLocaleTernary(), code, "app/[locale]/layout.tsx")).toEqual([]);
    expect(await lint(noLocaleTernary({ routing: ["lib/routes.ts"] }), code, "lib/routes.ts")).toEqual([]);
  });

  it("keeps the selectors of krizaka.com", () => {
    const site = readFileSync(new URL("./fixtures/krizaka-com.eslint.txt", import.meta.url), "utf8");
    for (const selector of LOCALE_TERNARY_SELECTORS) expect(site).toContain(selector);
  });

  it("composes with krizakaUi (no clash on no-restricted-syntax)", async () => {
    const code = `export const A = ({ locale }: { locale: string }) => <p className="text-zinc-400">{locale === "fr" ? "Oui" : "Yes"}</p>;`;
    expect(ids(await lint([...krizakaUi(), ...noLocaleTernary()], code)).sort()).toEqual([
      "krizaka/no-locale-ternary",
      "no-restricted-syntax",
    ]);
  });
});

describe("krizakaBase", () => {
  it("lints TypeScript, React hooks and import order", async () => {
    const code = [
      `import { useState } from "react";`,
      `import { a } from "./a";`,
      `import path from "node:path";`,
      `export function useX(on: boolean) { if (on) { useState(0); } const unused = 1; return path.sep + a; }`,
    ].join("\n");
    const messages = await lint(krizakaBase, code, "src/use-x.ts");
    expect(ids(messages)).toEqual(
      expect.arrayContaining([
        "simple-import-sort/imports",
        "react-hooks/rules-of-hooks",
        "@typescript-eslint/no-unused-vars",
      ]),
    );
  });

  it("accepts clean code and `_`-prefixed unused arguments", async () => {
    const code = `export const add = (a: number, _b: number): number => a + 1;\n`;
    expect(await lint(krizakaBase, code, "src/add.ts")).toEqual([]);
  });

  it("never lints generated output", async () => {
    const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: krizakaBase });
    expect(await eslint.isPathIgnored("dist/index.js")).toBe(true);
    expect(await eslint.isPathIgnored("apps/web/.next/server/page.js")).toBe(true);
  });
});

describe("krizakaNext", () => {
  it("carries eslint-config-next and the shared basics", async () => {
    const names = krizakaNext.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(["krizaka/ignores", "krizaka/imports", "next", "next/typescript"]));
    const messages = await lint(krizakaNext, `export default function P() { return <img src="/a.png" alt="" />; }\n`, "app/page.tsx");
    expect(ids(messages)).toContain("@next/next/no-img-element");
  });
});

describe("krizakaStack — the three stack rules (S1–S3, S11)", () => {
  const client = (body: string) => `"use client";\nimport { useEffect } from "react";\n${body}`;

  it("no-fetch-in-client-effect: a fetch or krizakaFetch inside an effect of a client file", async () => {
    const code = client(
      `export function useX(u: string) { useEffect(() => { void fetch(u); void window.fetch(u); void krizakaFetch(u); }, [u]); }\ndeclare function krizakaFetch(u: string): Promise<unknown>;`,
    );
    const messages = await lint(krizakaStack(), code, "hooks/use-x.ts");
    expect(ids(messages)).toEqual(Array(3).fill("krizaka/no-fetch-in-client-effect"));
    expect(messages[0]!.severity).toBe(1); // a warning: the ratchet holds the count
  });

  it("no-fetch-in-client-effect: allows a fetch outside an effect, refetch, and server files", async () => {
    const outside = client(`export function useX(u: string, refetch: () => void) { useEffect(() => { refetch(); }, [refetch]); return () => fetch(u); }`);
    expect(await lint(krizakaStack(), outside, "hooks/use-x.ts")).toEqual([]);
    const server = `import { useEffect } from "react";\nexport function useX(u: string) { useEffect(() => { void fetch(u); }, [u]); }`;
    expect(await lint(krizakaStack(), server, "hooks/use-x.ts")).toEqual([]);
  });

  it("no-direct-tanstack-import: every import form, never a facade", async () => {
    const code = [
      `import { useQuery } from "@tanstack/react-query";`,
      `export { flexRender } from "@tanstack/react-table";`,
      `export * from "@tanstack/table-core";`,
      `export const lazy = () => import("@tanstack/react-virtual");`,
      `import { createQueryClient } from "@krizaka/query";`,
      `export const used = [useQuery, createQueryClient];`,
    ].join("\n");
    const messages = await lint(krizakaStack(), code, "lib/data.ts");
    expect(ids(messages)).toEqual(Array(4).fill("krizaka/no-direct-tanstack-import"));
    expect(messages[0]!.message).toMatch(/@tanstack\/react-query is imported through its @krizaka facade/);
  });

  it("no-local-table-or-form: a table, a form of several fields — not a single-field form", async () => {
    const code = `export const A = () => (
      <>
        <form role="search"><input type="hidden" name="p" /><input name="q" /><button type="submit" /></form>
        <form><input name="a" /><Select name="b" /></form>
        <table><tbody /></table>
      </>
    );
    declare function Select(p: { name: string }): null;`;
    const messages = await lint(krizakaStack(), code, "app/page.tsx");
    expect(messages.map((m) => m.message)).toEqual([
      expect.stringMatching(/<form> of 2 fields/),
      expect.stringMatching(/<table>: use DataTable/),
    ]);
    expect(await lint(krizakaStack({ maxFormFields: 2 }), code, "app/page.tsx")).toHaveLength(1);
  });

  it("takes files, ignores and severity; composes with noLocaleTernary (one plugin object)", async () => {
    const code = `import { useQuery } from "@tanstack/react-query";\nexport const q = useQuery;`;
    expect(await lint(krizakaStack({ ignores: ["packages/**"] }), code, "packages/query/src/index.ts")).toEqual([]);
    expect(await lint(krizakaStack({ files: ["apps/**/*.ts"] }), code, "lib/x.ts")).toEqual([]);
    expect((await lint(krizakaStack({ severity: "error" }), code, "lib/x.ts"))[0]!.severity).toBe(2);
    const both = `${code}\nexport const t = (locale: string) => (locale === "fr" ? "Oui" : "Yes");`;
    expect(ids(await lint([...krizakaStack(), ...noLocaleTernary()], both, "lib/x.ts")).sort()).toEqual([
      "krizaka/no-direct-tanstack-import",
      "krizaka/no-locale-ternary",
    ]);
  });

  it("names exactly three rules", () => {
    expect(STACK_RULES).toHaveLength(3);
    expect(Object.keys(krizakaStack()[0]!.rules!)).toEqual([...STACK_RULES]);
  });
});

describe("krizaka/env-name — environment variables named by bounded context (krizaka/.github#46)", () => {
  it("is on in krizakaBase and krizakaNext", async () => {
    const code = `export const k = process.env.BUNNY_STORAGE_API_KEY;`;
    expect(ids(await lint(krizakaBase, code, "lib/storage.ts"))).toContain("krizaka/env-name");
    expect(ids(await lint(krizakaNext, code, "lib/storage.ts"))).toContain("krizaka/env-name");
  });

  it("refuses a product or a vendor prefix, also behind NEXT_PUBLIC_ / EXPO_PUBLIC_ and in import.meta.env", async () => {
    const code = [
      `export const a = process.env.KRIZAKA_ADMIN_API_TOKEN;`,
      `export const b = process.env["MAILGUN_API_KEY"];`,
      `export const c = process.env.NEXT_PUBLIC_ACME_APP_URL;`,
      `export const d = process.env.EXPO_PUBLIC_ACME_URL;`,
      `export const e = import.meta.env.VITE_BUNNY_CDN;`,
    ].join("\n");
    const messages = (await lint(envNames({ products: ["ACME"] }), code, "lib/env.ts")).filter((m) => m.ruleId === "krizaka/env-name");
    expect(messages).toHaveLength(5);
    expect(messages[0]!.message).toMatch(/product \(KRIZAKA_\)/);
    expect(messages[1]!.message).toMatch(/vendor \(MAILGUN_\).*MAIL_API_KEY/);
  });

  it("accepts context names, the runtime's and the platforms' own", async () => {
    const code = [
      `export const a = process.env.MEDIA_STORAGE_API_KEY;`,
      `export const b = process.env.NEXT_PUBLIC_APP_URL;`,
      `export const c = process.env.EXPO_PUBLIC_APP_URL;`,
      `export const d = process.env.NODE_ENV + process.env.PORT + process.env.CI;`,
      `export const e = process.env.GITHUB_TOKEN ?? process.env.EAS_BUILD;`,
      `export const f = process.env[name];`,
    ].join("\n");
    expect((await lint(envNames(), code, "lib/env.ts")).filter((m) => m.ruleId === "krizaka/env-name")).toEqual([]);
  });

  it("refuses the repository's own product, read from its package.json", async () => {
    const dir = mkdtempSync(join(tmpdir(), "env-name-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "@acme/zebra-admin" }));
    expect(ownProductPrefix(dir)).toBe("ZEBRA");
    const block = mkdtempSync(join(tmpdir(), "env-name-"));
    writeFileSync(join(block, "package.json"), JSON.stringify({ name: "@acme/realtime" }));
    expect(ownProductPrefix(block)).toBeNull();
    const eslint = new ESLint({ cwd: dir, overrideConfigFile: true, overrideConfig: [TSX, ...envNames()] });
    const [result] = await eslint.lintText(`export const t = process.env.ZEBRA_API_TOKEN;`, { filePath: join(dir, "lib/a.ts") });
    expect(result!.messages.map((m) => m.message)).toEqual([expect.stringMatching(/product \(ZEBRA_\)/)]);
  });

  it("takes extra products, vendors and allowed names", async () => {
    const code = `export const a = process.env.ACME_KEY; export const b = process.env.BUNNY_LEGACY;`;
    const messages = await lint(envNames({ vendors: ["ACME"], allow: ["BUNNY_LEGACY"] }), code, "lib/env.ts");
    expect(messages.map((m) => m.message)).toEqual([expect.stringMatching(/ACME_/)]);
  });

  it("names the refused prefix for scripts (envNamePrefixProblem)", () => {
    expect(envNamePrefixProblem("ACME_RELEASE_APPROVAL", { products: ["ACME"] })).toEqual({ prefix: "ACME", kind: "product" });
    expect(envNamePrefixProblem("MAILGUN_DOMAIN")).toEqual({ prefix: "MAILGUN", kind: "vendor" });
    expect(envNamePrefixProblem("NEXT_PUBLIC_CDN_URL")).toBeNull();
    expect(envNamePrefixProblem("APP_RELEASE_APPROVAL")).toBeNull();
  });
});

describe("krizakaUiWarnings — no-light-variant and no-raw-palette, named, as warnings", () => {
  it("names the two rules", () => {
    expect(UI_WARNING_RULES).toEqual(["krizaka/no-light-variant", "krizaka/no-raw-palette"]);
  });

  it("no-raw-palette: a palette step in className, nested in cn() and ternaries too; a role is fine", async () => {
    const code = `export const A = ({ on }: { on: boolean }) => <><div className="p-2 bg-zinc-900/60" /><i className={cn("p-2", on ? "text-violet-400" : "text-fg")} /><b className="bg-surface-1 text-accent" /></>;`;
    const messages = await lint(krizakaUiWarnings(), code);
    expect(ids(messages)).toEqual(["krizaka/no-raw-palette", "krizaka/no-raw-palette"]);
    expect(messages[0]!.severity).toBe(1); // a warning: the ratchet holds the count
  });

  it("no-raw-palette: `allow` tolerates a family for a documented case", async () => {
    const code = `export const A = () => <div className="text-emerald-400 bg-zinc-900" />;`;
    expect(ids(await lint(krizakaUiWarnings({ allow: ["emerald"] }), code))).toEqual(["krizaka/no-raw-palette"]);
  });

  it("no-light-variant: `light:` in className, never a `.light` word elsewhere", async () => {
    const code = `export const A = () => <><div className="light:bg-white" /><p className="text-fg">light: a word</p></>;`;
    const messages = await lint(krizakaUiWarnings(), code);
    expect(ids(messages)).toEqual(["krizaka/no-light-variant"]);
    expect(messages[0]!.message).toMatch(/theme is a set of tokens/);
  });

  it("only looks at className, and at the files given", async () => {
    expect(await lint(krizakaUiWarnings(), `export const a = "bg-zinc-900 light:x";`)).toEqual([]);
    expect(await lint(krizakaUiWarnings({ files: ["**/*.nope"] }), `export const A = () => <div className="bg-zinc-900" />;`)).toEqual([]);
  });

  it("can be raised to errors", async () => {
    const messages = await lint(krizakaUiWarnings({ severity: "error" }), `export const A = () => <div className="light:x bg-zinc-900" />;`);
    expect(messages.map((m) => m.severity)).toEqual([2, 2]);
  });
});
