// The rule modules of the `krizaka` ESLint plugin (eslint/plugin.js). Patterns come from ../patterns.js, which the
// ratchet reads too: a rule and its counter never diverge.
import { countFormFields, EFFECT_NAMES_SOURCE, FETCH_NAMES_SOURCE, TANSTACK_SCOPE } from "../patterns.js";

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

/** S11: `@tanstack/*` is imported by the `@krizaka/*` packages only — the version is the contract. */
/** @type {RuleModule} */
export const noDirectTanstackImport = {
  meta: {
    type: "problem",
    docs: { description: "Forbid importing @tanstack/* outside the @krizaka/* packages." },
    schema: [],
    messages: {
      tanstack:
        "{{source}} is imported through its @krizaka facade (@krizaka/query, @krizaka/ui/data-table, @krizaka/ui/form, @krizaka/ui/virtual, @krizaka/pacer…), never directly.",
    },
  },
  create(context) {
    /** @param {Node | null | undefined} source */
    const check = (source) => {
      if (source?.type === "Literal" && typeof source.value === "string" && source.value.startsWith(TANSTACK_SCOPE)) {
        context.report({ node: source, messageId: "tanstack", data: { source: source.value } });
      }
    };
    return {
      ImportDeclaration: (node) => check(node.source),
      ExportNamedDeclaration: (node) => check(node.source),
      ExportAllDeclaration: (node) => check(node.source),
      ImportExpression: (node) => check(node.source),
      "CallExpression[callee.name='require']": (/** @type {import("estree").CallExpression} */ node) =>
        check(/** @type {Node} */ (node.arguments[0])),
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
