/* The pure half of the generator (scripts/gen-packages.mjs): everything that turns a package of ../packages into the words of
   its page — README made safe for MDX, relative links made absolute, the exports read from the TypeScript program, the
   changelog, the page itself in each language. No I/O here, so tests/packages.test.mjs reads it directly. */

import { existsSync } from "node:fs";

import ts from "typescript";

export const SITE_URL = "https://ts.krizaka.com";
export const REPOSITORY_URL = "https://github.com/krizaka/krizaka-ts";
export const NPM_URL = "https://www.npmjs.com/package";

/** The page of a package: its folder name (`api-keys`), the URL `/api-keys/`. */
export const slugOf = (dir) => dir;

/** Applies `fn` to the prose of a Markdown text only: not to fenced code, not to inline code spans. */
export function onProse(markdown, fn) {
  let fence = null;
  return markdown
    .split("\n")
    .map((line) => {
      const open = line.match(/^\s*(`{3,}|~{3,})/);
      if (fence) {
        if (open && open[1][0] === fence[0] && open[1].length >= fence.length) fence = null;
        return line;
      }
      if (open) {
        fence = open[1];
        return line;
      }
      return line
        .split(/(`+[^`]*`+)/)
        .map((part, i) => (i % 2 === 1 ? part : fn(part)))
        .join("");
    })
    .join("\n");
}

/** MDX reads `{` as an expression and `<` as a tag: in prose they are escaped (autolinks `<https://…>` are kept). */
export const mdxSafe = (markdown) =>
  onProse(markdown, (text) => text.replace(/<(https?:\/\/[^>\s]+)>/g, "\uE000$1\uE001").replace(/[{}]/g, (c) => `\\${c}`).replaceAll("<", "&lt;").replaceAll("\uE000", "<").replaceAll("\uE001", ">"));

/** A README's relative links and images, made absolute on GitHub (the page is not in the repository's folder). */
export function absolutizeLinks(markdown, dir) {
  const base = `${REPOSITORY_URL}/blob/main/packages/${dir}/`;
  return onProse(markdown, (text) =>
    text.replace(/(\]\()([^)\s]+)(\))/g, (whole, open, href, close) => (/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(href) ? whole : `${open}${new URL(href, base).href}${close}`)),
  );
}

/** The README without its first heading (the page has its own title). */
export const withoutTitle = (readme) => readme.replace(/^\s*# .*\n+/, "");

/* ─── Exports, read from the TypeScript program of the package ─── */

const firstSentence = (text) => {
  const flat = text.replace(/\s+/g, " ").trim();
  const cut = flat.match(/^(.+?[.!?])(\s|$)/)?.[1] ?? flat;
  return cut.length > 160 ? `${cut.slice(0, 157).trimEnd()}…` : cut;
};

/** The exported names of a module (`entry`), each with its kind and the first sentence of its documentation comment. */
export function exportsOf(entry) {
  // a file that is no TypeScript or JavaScript module (a JSON map, .editorconfig) or that a package without sources
  // (plain JavaScript, no build: @krizaka/config) does not have, exports no names
  if (!entry || !/\.(ts|mts|js|mjs|cjs)$/.test(entry) || !existsSync(entry)) return [];
  const program = ts.createProgram([entry], {
    allowJs: true,
    noEmit: true,
    skipLibCheck: true,
    allowImportingTsExtensions: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2022,
    strict: true,
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(entry);
  if (!source) throw new Error(`${entry}: not found`);
  const module = checker.getSymbolAtLocation(source);
  if (!module) return [];
  const kindOf = (symbol) => {
    const F = ts.SymbolFlags;
    if (symbol.flags & F.Class) return "class";
    if (symbol.flags & F.Function) return "function";
    if (symbol.flags & F.Enum) return "enum";
    if (symbol.flags & F.Variable) {
      const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
      return declaration && checker.getTypeOfSymbolAtLocation(symbol, declaration).getCallSignatures().length > 0 ? "function" : "const";
    }
    return "type";
  };
  return checker
    .getExportsOfModule(module)
    .map((exported) => {
      const target = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
      return { name: exported.getName(), kind: kindOf(target), summary: firstSentence(ts.displayPartsToString(target.getDocumentationComment(checker))) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The source file behind a package.json `exports` entry (`./dist/testkit.js` → `src/testkit.ts`). */
export const sourceOfExport = (target) => {
  const file = typeof target === "string" ? target : (target.import ?? target.default ?? target.types);
  if (typeof file !== "string") return null;
  // a built package maps dist/ to src/; a plain-JavaScript one (no build) exports its files as they are
  return file.startsWith("./dist/") ? file.replace(/^\.\/dist\//, "src/").replace(/\.(d\.ts|js|mjs|cjs)$/, ".ts") : file;
};

/* ─── The changelog (Changesets) ─── */

/** CHANGELOG.md of a package as page Markdown: a heading per version, the kind of change in bold, the commit hash dropped. */
export function changelogBody(changelog) {
  return mdxSafe(
    changelog
      .replace(/^\s*# .*\n+/, "")
      .replace(/^## (.+)$/gm, "### $1")
      .replace(/^### (Major|Minor|Patch) Changes$/gm, "**$1 changes**")
      .replace(/^- [0-9a-f]{7,}: /gm, "- ")
      .trim(),
  );
}

/* ─── The page ─── */

/** The install command, in a page: the `InstallTabs` component (app/components/mdx.tsx), which draws @krizaka/ui's CodeTabs with a copy button. */
export const installTabs = (name) => `<InstallTabs name="${name}" />`;

const cell = (text) => text.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/[{}]/g, (c) => `\\${c}`).replace(/</g, "&lt;");

function exportsTable(items, t) {
  const rows = items.map((e) => `| \`${e.name}\` | ${t.kinds[e.kind]} | ${cell(e.summary)} |`);
  return [`| ${t.exports.name} | ${t.exports.kind} | ${t.exports.summary} |`, "| :-- | :-- | :-- |", ...rows].join("\n");
}

const list = (record) => Object.entries(record ?? {}).map(([name, range]) => `\`${name}\` ${range}`);

/**
 * The MDX page of one package in one language.
 * @param pkg      { id, name, version|null, license, node, dependencies, peerDependencies, exports, subpaths, readme, changelog }
 * @param locale   "en" | "fr"
 * @param messages the dictionary of that language (messages/<locale>.json)
 */
export function renderPage(pkg, locale, messages) {
  const t = messages.docs;
  const hook = messages.packages[pkg.id]?.hook;
  if (!hook) throw new Error(`messages: packages.${pkg.id}.hook is missing (${locale})`);
  const npmUrl = `${NPM_URL}/${pkg.name}`;
  const sourceUrl = `${REPOSITORY_URL}/tree/main/packages/${pkg.id}`;
  const facts = [
    pkg.version ? `| ${t.facts.version} | %${pkg.name}% ([npm](${npmUrl})) |` : `| ${t.facts.version} | ${t.facts.unpublished} |`,
    `| ${t.facts.license} | ${pkg.license} |`,
    pkg.node ? `| ${t.facts.node} | \`${pkg.node}\` |` : null,
    `| ${t.facts.dependencies} | ${list(pkg.dependencies).join(", ") || t.facts.none} |`,
    list(pkg.peerDependencies).length ? `| ${t.facts.peers} | ${list(pkg.peerDependencies).join(", ")} |` : null,
    `| ${t.facts.source} | [${pkg.id}](${sourceUrl}) |`,
  ].filter(Boolean);

  const parts = [
    `---\ntitle: ${JSON.stringify(pkg.name)}\ndescription: ${JSON.stringify(hook)}\n---`,
    `## ${t.install.title}`,
    installTabs(pkg.name),
    pkg.subpaths.length ? t.install.subpaths.replace("{paths}", pkg.subpaths.map((s) => `\`${pkg.name}${s.path.slice(1)}\``).join(", ")) : null,
    locale === "fr" ? `> ${t.readmeNote}` : null,
    mdxSafe(absolutizeLinks(withoutTitle(pkg.readme), pkg.id)).trim(),
    `## ${t.exports.title}`,
    t.exports.lead.replace("{count}", String(pkg.exports.length)),
    exportsTable(pkg.exports, t),
    ...pkg.subpaths.flatMap((s) => [`### \`${pkg.name}${s.path.slice(1)}\``, exportsTable(s.exports, t)]),
    `## ${t.facts.title}`,
    [`| | |`, "| :-- | :-- |", ...facts].join("\n"),
    pkg.changelog ? `## ${t.changelog.title}\n\n${changelogBody(pkg.changelog)}` : null,
  ];
  return `${parts.filter((p) => p !== null).join("\n\n")}\n`;
}

/** content/docs/meta.json (and meta.fr.json): `start`, then the packages in the order of the repository's README. */
export const metaOf = (title, ids, labels) => ({ title, pages: ["start", `---${labels.packages}---`, ...ids] });

/** The packages in the order of the repository README's table (`packages/<dir>#readme`); a package the README does not list fails. */
export function orderFromReadme(readme, dirs) {
  const listed = [...readme.matchAll(/\]\(packages\/([a-z0-9-]+)(?:#readme)?\)/g)].map((m) => m[1]).filter((d, i, all) => all.indexOf(d) === i);
  const missing = dirs.filter((d) => !listed.includes(d));
  if (missing.length) throw new Error(`README.md does not list ${missing.join(", ")} — the repository README is the catalogue`);
  return listed.filter((d) => dirs.includes(d));
}
