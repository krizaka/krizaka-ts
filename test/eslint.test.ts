import { readFileSync } from "node:fs";

import { ESLint, type Linter } from "eslint";
import tseslint from "typescript-eslint";

import { krizakaBase } from "../eslint/index.js";
import { krizakaUi, krizakaUiRestrictedSyntax, krizakaUiRules } from "../eslint/krizaka-ui.js";
import { krizakaNext } from "../eslint/next.js";
import { LOCALE_TERNARY_SELECTORS, noLocaleTernary } from "../eslint/no-locale-ternary.js";

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
