// The shared dependency-cruiser rules of a Krizaka app (the stack ADR, decision S11; « Krizaka first », krizaka-ui#609 and
// #612). dependency-cruiser carries the IMPORT rules of the family, ESLint the framework ones (krizaka/.github
// docs/quality-controls.md §4, §7). An app extends it and adds its own:
//
//   // .dependency-cruiser.cjs
//   module.exports = { extends: "@krizaka/config/dependency-cruiser", forbidden: [/* the app's rules */] };
//
// dependency-cruiser concatenates `forbidden` and merges `options`. CommonJS: dependency-cruiser requires its configs.
//
// - `krizaka-first-<domain>`: one rule per domain of covered-domains.json (dates, i18n, query, icons, ui): an app never
//   imports the library a Krizaka package owns; the message names the Krizaka home. A Krizaka package in node_modules is
//   the facade and is never checked. A monorepo whose own packages are the facades says where they live:
//   `require("@krizaka/config/dependency-cruiser").withOptions({ exemptFrom: ["(^|/)packages/"] })`.
// - `no-circular`, `not-to-unresolvable`, `not-to-dev-dep`: the three every repository owes.
// - The known violations of an app that adopts the rules late: see README, « Known violations » (krizaka-known-violations).

const { coveredDomains, domainMessage, domainPattern, ruleName } = require("./covered-domains.cjs");

const NODE_MODULES = "(^|/)node_modules/";
/** Files that may import a dev dependency: tests, stories, scripts and the tools' own configuration. */
const DEV_FILES =
  "(^|/)(tests?|__tests__|__mocks__|e2e|scripts|\\.storybook|stories)/|[.](spec|test|stories|config)[.](js|mjs|cjs|jsx|ts|mts|cts|tsx)$|(^|/)\\.[^/]+rc[.](js|cjs|mjs|ts)$|(^|/)\\.dependency-cruiser[.]cjs$";

/**
 * The preset, for an app whose own sources are everything outside node_modules.
 * @param {{ exemptFrom?: string[] }} [options] `exemptFrom`: path patterns of the Krizaka packages that live in this repository
 *   (they are the facades: they wrap the library, so they may import it).
 * @returns {{ forbidden: Record<string, unknown>[], options: Record<string, unknown> }} an `IConfiguration` of dependency-cruiser
 */
function createConfig({ exemptFrom = [] } = {}) {
  const exempt = [NODE_MODULES, ...exemptFrom];
  return {
    forbidden: [
      ...coveredDomains.map((domain) => ({
        name: ruleName(domain),
        severity: "error",
        comment: domainMessage(domain),
        // the app's own sources; the @krizaka/* packages in node_modules are where the library belongs
        from: { pathNot: exempt },
        // resolved (node_modules/…) or not (a package the app does not declare)
        to: { path: domainPattern(domain) },
      })),
      {
        name: "no-circular",
        severity: "error",
        comment: "A cycle makes the order of loading a matter of luck and blocks tree shaking: move what both sides need to a third module.",
        from: {},
        to: { circular: true },
      },
      {
        name: "not-to-unresolvable",
        severity: "error",
        comment: "The import points to nothing: a missing file, a missing dependency or a ghost dependency that only works by hoisting. Declare it in package.json or fix the path.",
        from: {},
        to: { couldNotResolve: true },
      },
      {
        name: "not-to-dev-dep",
        severity: "error",
        comment: "Production code imports a devDependency: it is not installed in production. Move the package to `dependencies` (or `peerDependencies`, for a library whose consumer installs it), or the import to a test.",
        from: { pathNot: [NODE_MODULES, DEV_FILES] },
        // a package that is also a peer dependency (the library declares it for its consumer, and keeps a copy to test with) is installed where it is used
        to: { dependencyTypes: ["npm-dev"], dependencyTypesNot: ["type-only", "npm-peer"], pathNot: ["node_modules/@types/"] },
      },
    ],
    options: {
      doNotFollow: { path: NODE_MODULES },
      tsPreCompilationDeps: true,
      enhancedResolveOptions: {
        exportsFields: ["exports"],
        conditionNames: ["import", "require", "node", "default"],
      },
    },
  };
}

module.exports = createConfig();
// not enumerable: dependency-cruiser validates the keys of the configuration it loads
Object.defineProperty(module.exports, "withOptions", { value: createConfig, enumerable: false });
