// The rule modules of the `krizaka` ESLint plugin (eslint/plugin.js). Patterns come from ../patterns.js, which the
// ratchet reads too: a rule and its counter never diverge.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { countFormFields, EFFECT_NAMES_SOURCE, FETCH_NAMES_SOURCE, isLocalSelection, LIGHT_VARIANT_SOURCE, paletteSource } from "../patterns.js";

/** @typedef {import("eslint").Rule.RuleModule} RuleModule */
/** @typedef {import("estree").Node} Node */

/** The selectors of `no-locale-ternary`, also usable in `no-restricted-syntax`. */
export const LOCALE_TERNARY_SELECTORS = Object.freeze([
  "ConditionalExpression[test.type='BinaryExpression'][test.right.value=/^(fr|en)$/]",
  "ConditionalExpression > Identifier.test[name=/^(isFr|isEn|fr)$/]",
]);

/** @type {RuleModule} */
export const noLocaleTernaryRule = {
  meta: {
    type: "problem",
    docs: { description: "Forbid choosing a text with a locale ternary outside routing code." },
    schema: [],
    messages: {
      localeTernary:
        "Put the text in the message catalogues (messages/<locale>.json) and read it from the dictionary (t.…).",
    },
  },
  create(context) {
    /** @type {Record<string, (node: Node) => void>} */
    const visitors = {};
    for (const selector of LOCALE_TERNARY_SELECTORS) {
      visitors[selector] = (node) => context.report({ node, messageId: "localeTernary" });
    }
    return visitors;
  },
};

/**
 * True when the file starts with a `"use client"` directive.
 * @param {import("eslint").Rule.RuleContext} context
 */
function isClientFile(context) {
  for (const statement of context.sourceCode.ast.body) {
    if (statement.type !== "ExpressionStatement" || !("directive" in statement)) return false;
    if (statement.directive === "use client") return true;
  }
  return false;
}

const callee = (/** @type {string} */ names) => `:matches([callee.name=/${names}/], [callee.property.name=/${names}/])`;

/** S1: the first screen is a Server Component, the interaction is Query — never a fetch in a client effect. */
/** @type {RuleModule} */
export const noFetchInClientEffect = {
  meta: {
    type: "suggestion",
    docs: { description: "Forbid a fetch (or krizakaFetch) inside a useEffect of a \"use client\" file." },
    schema: [],
    messages: {
      fetchInEffect:
        "A fetch in a client effect: render the first screen in a Server Component and read the rest with @krizaka/query (useQuery / useMutation).",
    },
  },
  create(context) {
    if (!isClientFile(context)) return {};
    return {
      [`CallExpression${callee(EFFECT_NAMES_SOURCE)} CallExpression${callee(FETCH_NAMES_SOURCE)}`]: (/** @type {Node} */ node) =>
        context.report({ node, messageId: "fetchInEffect" }),
    };
  },
};

/** Oussama, 2026-10-22: « changer les tabs doit changer les routes » — a selection of a page lives in the URL. */
/** @type {RuleModule} */
export const routeStateSelection = {
  meta: {
    type: "problem",
    docs: { description: "A Tabs / segmented / toggle / chip-group selection in a page keeps its state in the URL (routeKey), not in local state." },
    schema: [],
    messages: {
      local:
        "This selection is local state: changing it does not change the URL. Bind it to the route with `routeKey=\"…\"` (and `routeValues`, see `useRouteState` in @krizaka/ui/router), or justify it with `// @ephemeral: <reason>` on this line or the one above.",
    },
  },
  create(context) {
    const source = context.sourceCode;
    return {
      JSXOpeningElement: (/** @type {Node} */ node) => {
        const lines = source.lines;
        const line = /** @type {import("estree").SourceLocation} */ (node.loc).start.line;
        if (isLocalSelection(source.getText(node), lines[line - 2] ?? "")) context.report({ node, messageId: "local" });
      },
    };
  },
};

/** Oussama, 2026-10-22: krizaka.com is the only way back between the sites; no site carries the family switcher. */
/** @type {RuleModule} */
export const noFamilySwitcher = {
  meta: {
    type: "problem",
    docs: { description: "Forbid the family switcher (NavBar.Family): krizaka.com is the only link back between the Krizaka sites." },
    schema: [],
    messages: {
      family:
        "No family switcher (NavBar.Family) on any site: krizaka.com is the only way back. The footer carries one quiet « A Krizaka project » link to https://www.krizaka.com (SiteFooter).",
    },
  },
  create(context) {
    return {
      "JSXMemberExpression[object.name='NavBar'][property.name='Family']": (/** @type {Node} */ node) => context.report({ node, messageId: "family" }),
      "JSXIdentifier[name='NavBarFamily']": (/** @type {Node} */ node) => context.report({ node, messageId: "family" }),
      "ImportSpecifier[imported.name='NavBarFamily']": (/** @type {Node} */ node) => context.report({ node, messageId: "family" }),
    };
  },
};

/** S2, S3: a table is `@krizaka/ui/data-table`, a form is `@krizaka/ui/form` — except a form of a single field. */
/** @type {RuleModule} */
export const noLocalTableOrForm = {
  meta: {
    type: "suggestion",
    docs: { description: "Forbid a hand-written <table> or <form> in an app (single-field forms excepted)." },
    schema: [
      {
        type: "object",
        properties: { maxFormFields: { type: "integer", minimum: 0 } },
        additionalProperties: false,
      },
    ],
    messages: {
      table: "A hand-written <table>: use DataTable from @krizaka/ui/data-table.",
      form: "A hand-written <form> of {{fields}} fields: use createKrizakaForm from @krizaka/ui/form.",
    },
  },
  create(context) {
    const maxFormFields = context.options[0]?.maxFormFields ?? 1;
    return {
      /** @param {any} node JSXOpeningElement */
      "JSXOpeningElement[name.type='JSXIdentifier']:matches([name.name='table'], [name.name='form'])"(node) {
        if (node.name.name === "table") return context.report({ node, messageId: "table" });
        const fields = countFormFields(context.sourceCode.getText(node.parent));
        if (fields > maxFormFields) context.report({ node, messageId: "form", data: { fields: String(fields) } });
      },
    };
  },
};

/**
 * The organisation's name is never a prefix; a repository's own product is found from its package.json (below) and a
 * config may name more (`products`): a deployment already says which product it is (krizaka/.github#46).
 */
export const ENV_PRODUCT_PREFIXES = Object.freeze(["KRIZAKA"]);

/** The bounded contexts a name starts with (krizaka/.github#46). */
export const ENV_CONTEXT_WORDS = Object.freeze(["APP", "DATABASE", "AUTH", "MEDIA", "MAIL", "PUSH", "PAYMENTS", "REALTIME", "ABUSE", "OBSERVABILITY", "AI", "OPERATOR"]);

/** @type {Map<string, string | null>} */
const ownProductCache = new Map();

/**
 * The product a repository is: the first word of the nearest package.json's name, scope removed
 * (`acme-monorepo` → ACME, `@org/acme-admin` → ACME); null for a one-word name (`@org/realtime`) or a context word.
 * @param {string} cwd
 */
export function ownProductPrefix(cwd) {
  if (ownProductCache.has(cwd)) return ownProductCache.get(cwd) ?? null;
  let found = null;
  for (let dir = cwd; ; dir = dirname(dir)) {
    const file = join(dir, "package.json");
    if (existsSync(file)) {
      try {
        const name = String(JSON.parse(readFileSync(file, "utf8")).name ?? "");
        // A product names its packages `<product>-<part>` (acme-monorepo, @org/acme-admin); a one-word package
        // (@org/realtime, @org/ui) is a building block, not a product, and a context word is never one.
        const words = name.replace(/^@[^/]+\//, "").split(/[-_.]/).filter(Boolean);
        const word = words.length > 1 ? words[0].toUpperCase() : "";
        found = /^[A-Z][A-Z0-9]+$/.test(word) && !ENV_CONTEXT_WORDS.includes(word) ? word : null;
      } catch {
        found = null;
      }
      break;
    }
    if (dirname(dir) === dir) break;
  }
  ownProductCache.set(cwd, found);
  return found;
}

/** Vendors: a vendor is a value (`MEDIA_STORAGE_PROVIDER=bunny`, `MAIL_PROVIDER=mailgun`), never a name. */
export const ENV_VENDOR_PREFIXES = Object.freeze([
  "BUNNY", "MAILGUN", "RESEND", "SENDGRID", "POSTMARK", "STRIPE", "CCBILL", "SEGPAY", "NOWPAYMENTS", "PAYPAL",
  "TURNSTILE", "CLOUDFLARE", "VERCEL", "DIGITALOCEAN", "DO", "AWS", "GCP", "AZURE", "GOOGLE", "FACEBOOK", "APPLE",
  "GITHUB", "GH", "EXPO", "FIREBASE", "FCM", "APNS", "REDIS", "VALKEY", "OPENAI", "ANTHROPIC", "OLLAMA", "SENTRY",
  "TWILIO", "SUPABASE", "MAPBOX",
]);

/** Names the platforms set themselves (GitHub Actions, EAS): read, never chosen. */
export const ENV_PLATFORM_NAMES = Object.freeze([
  "GITHUB_ACTIONS", "GITHUB_TOKEN", "GITHUB_SHA", "GITHUB_REF", "GITHUB_REF_NAME", "GITHUB_REPOSITORY", "GITHUB_RUN_ID",
  "GITHUB_RUN_NUMBER", "GITHUB_WORKSPACE", "GITHUB_OUTPUT", "GITHUB_STEP_SUMMARY", "GITHUB_EVENT_NAME", "GITHUB_SERVER_URL",
  "EAS_BUILD", "EAS_BUILD_PLATFORM", "EAS_BUILD_PROFILE",
  "EXPO_TOKEN",
]);

/** The framework prefixes a client-exposed value needs; the name after them follows the same rule. */
const PUBLIC_PREFIX = /^(?:NEXT_PUBLIC_|EXPO_PUBLIC_|VITE_)/;

/**
 * The prefix that makes an environment variable name refused, or null. Exported for scripts and tests.
 * @param {string} name
 * @param {{ products?: readonly string[], vendors?: readonly string[], allow?: readonly string[] }} [options]
 * @returns {{ prefix: string, kind: "product" | "vendor" } | null}
 */
export function envNamePrefixProblem(name, { products = ENV_PRODUCT_PREFIXES, vendors = ENV_VENDOR_PREFIXES, allow = ENV_PLATFORM_NAMES } = {}) {
  if (allow.includes(name)) return null;
  const bare = name.replace(PUBLIC_PREFIX, "");
  const head = bare.split("_")[0] ?? "";
  if (bare === head) return null; // one word (PORT, CI): no prefix to judge
  if (products.includes(head)) return { prefix: head, kind: "product" };
  if (vendors.includes(head)) return { prefix: head, kind: "vendor" };
  return null;
}

/** The name read by `process.env.X`, `process.env["X"]` or `import.meta.env.X`, or null. */
function envNameOf(/** @type {any} */ node) {
  const object = node.object;
  const isProcessEnv = object?.type === "MemberExpression" && object.object?.type === "Identifier" && object.object.name === "process" && !object.computed && object.property?.name === "env";
  const isImportMetaEnv = object?.type === "MemberExpression" && object.object?.type === "MetaProperty" && !object.computed && object.property?.name === "env";
  if (!isProcessEnv && !isImportMetaEnv) return null;
  if (!node.computed && node.property?.type === "Identifier") return node.property.name;
  if (node.computed && node.property?.type === "Literal" && typeof node.property.value === "string") return node.property.value;
  return null;
}

/**
 * Environment variables are named by bounded context — `<CONTEXT>_<THING>` (APP_, DATABASE_, AUTH_, MEDIA_, MAIL_,
 * PUSH_, PAYMENTS_, REALTIME_, ABUSE_, OBSERVABILITY_, AI_, OPERATOR_) — never after a product or a vendor
 * (krizaka/.github#46). The products refused: the organisation's name and the repository's own (its package.json). Options:
 * `products`, `vendors` (extra prefixes), `allow` (extra names a platform sets).
 * @type {RuleModule}
 */
export const envName = {
  meta: {
    type: "problem",
    docs: { description: "Forbid environment variable names prefixed with a product or a vendor (krizaka/.github#46)." },
    schema: [
      {
        type: "object",
        properties: {
          products: { type: "array", items: { type: "string" } },
          vendors: { type: "array", items: { type: "string" } },
          allow: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      product:
        "{{name}} is named after a product ({{prefix}}_): name it by its bounded context, <CONTEXT>_<THING> (APP_, DATABASE_, AUTH_, MEDIA_, MAIL_, PUSH_, PAYMENTS_, REALTIME_, ABUSE_, OBSERVABILITY_, AI_, OPERATOR_).",
      vendor:
        "{{name}} is named after a vendor ({{prefix}}_): the vendor is a value (<CONTEXT>_PROVIDER={{lower}}) and its settings sit under the context (e.g. MEDIA_STORAGE_API_KEY, MAIL_API_KEY).",
    },
  },
  create(context) {
    const options = context.options[0] ?? {};
    const own = ownProductPrefix(context.cwd);
    const products = [...ENV_PRODUCT_PREFIXES, ...(own && !ENV_VENDOR_PREFIXES.includes(own) ? [own] : []), ...(options.products ?? [])];
    const vendors = [...ENV_VENDOR_PREFIXES, ...(options.vendors ?? [])];
    const allow = [...ENV_PLATFORM_NAMES, ...(options.allow ?? [])];
    return {
      /** @param {any} node */
      MemberExpression(node) {
        const name = envNameOf(node);
        if (!name) return;
        const problem = envNamePrefixProblem(name, { products, vendors, allow });
        if (problem) context.report({ node, messageId: problem.kind, data: { name, prefix: problem.prefix, lower: problem.prefix.toLowerCase() } });
      },
    };
  },
};

/**
 * A rule that reports the className strings (literals and template chunks, in `className` attributes) matching a pattern.
 * @param {(options: { allow?: string[] }) => RegExp} pattern
 * @param {string} message
 * @returns {RuleModule}
 */
function classNameRule(pattern, message) {
  return {
    meta: {
      type: "suggestion",
      docs: { description: message },
      schema: [{ type: "object", properties: { allow: { type: "array", items: { type: "string" } } }, additionalProperties: false }],
      messages: { found: message },
    },
    create(context) {
      const options = /** @type {{ allow?: string[] }} */ (context.options[0] ?? {});
      const regex = pattern(options);
      const check = (/** @type {Node} */ node, /** @type {unknown} */ value) => {
        if (typeof value === "string" && regex.test(value)) context.report({ node, messageId: "found" });
      };
      return {
        "JSXAttribute[name.name='className'] Literal": (/** @type {any} */ node) => check(node, node.value),
        "JSXAttribute[name.name='className'] TemplateElement": (/** @type {any} */ node) => check(node, node.value.cooked),
      };
    },
  };
}

/** `krizaka/no-light-variant`: a theme is a set of tokens, never a `light:` variant (a dark island: `.theme-dark`). */
export const noLightVariant = classNameRule(() => new RegExp(LIGHT_VARIANT_SOURCE), "`light:` is forbidden in products: a theme is a set of tokens. A dark island? `.theme-dark` on the ancestor.");

/** `krizaka/no-raw-palette`: a component reads a role (`bg-surface-1`, `text-accent`), never a palette step (`bg-zinc-900`). */
export const noRawPalette = classNameRule(
  ({ allow = [] }) => new RegExp(paletteSource(allow)),
  "Raw palette colour: use a role (bg-surface-1, text-fg-secondary, border-border-default, text-accent, text-danger).",
);
