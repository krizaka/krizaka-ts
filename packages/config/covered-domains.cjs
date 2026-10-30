// The covered-domains map (covered-domains.json) and what is generated from it: dependency-cruiser patterns, the message
// that names the Krizaka home, the table of the « Use Krizaka first » page. CommonJS: dependency-cruiser `require`s its
// configs, and Node imports it from ESM (`import { coveredDomains } from "@krizaka/config/covered-domains"`).

const map = require("./covered-domains.json");

/** @typedef {{ id: string, title: string, home: string, use: string, refused: string[] }} CoveredDomain */

/** The domains, in the order of the map. @type {readonly CoveredDomain[]} */
const coveredDomains = Object.freeze(map.domains);

/** The last thing every message says. */
const MISSING_FUNCTION = "Missing function? add it to the package first.";

/** @param {string} text */
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The dependency-cruiser `to.path` regular expression of a refused entry. It matches the resolved file
 * (`…/node_modules/dayjs/index.js`, also under pnpm's `.pnpm/…/node_modules/`) and the module as written when it could not
 * be resolved (`dayjs`), never a local folder called `dayjs`.
 * `@scope/*` is a scope, `prefix*` a name prefix, anything else a package and its subpaths.
 * @param {string} entry
 */
function refusedPattern(entry) {
  const start = "(^|(^|/)node_modules/)";
  if (entry.endsWith("/*")) return `${start}${escapeRegExp(entry.slice(0, -1))}`;
  if (entry.endsWith("*")) return `${start}${escapeRegExp(entry.slice(0, -1))}[^/]*(/|$)`;
  return `${start}${escapeRegExp(entry)}(/|$)`;
}

/** One pattern for a whole domain. @param {CoveredDomain} domain */
const domainPattern = (domain) => domain.refused.map(refusedPattern).join("|");

/** The message of a domain: what is refused, the Krizaka home, and what to do when the function is missing. @param {CoveredDomain} domain */
const domainMessage = (domain) =>
  `Krizaka first (${domain.id}): this library is refused in an app. Use ${domain.use}. ${MISSING_FUNCTION}`;

/** The name of the dependency-cruiser rule of a domain. @param {CoveredDomain | string} domain */
const ruleName = (domain) => `krizaka-first-${typeof domain === "string" ? domain : domain.id}`;

/** The table of the page « Use Krizaka first » (Markdown), generated from the map. */
function coveredDomainsMarkdown() {
  const rows = coveredDomains.map(
    (domain) =>
      `| ${domain.title} | ${domain.use} | ${domain.refused.map((entry) => `\`${entry}\``).join(", ")} | \`${ruleName(domain)}\` |`,
  );
  return ["| Domain | Use | Refused in an app | Rule |", "| :-- | :-- | :-- | :-- |", ...rows].join("\n");
}

module.exports = {
  coveredDomains,
  domainMessage,
  domainPattern,
  coveredDomainsMarkdown,
  MISSING_FUNCTION,
  refusedPattern,
  ruleName,
};
