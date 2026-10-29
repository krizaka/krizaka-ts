// The import rules of Krizaka TS: the shared preset of @krizaka/config (« Krizaka first », cycles, unresolvable imports, dev
// dependencies in production code) plus the one boundary of ADR-004: krizaka-ts runs anywhere without drawing anything, so a
// package here never imports the packages that render. Run it with `pnpm run lint:deps` (scripts/deps.mjs: one run per package,
// from the package's own folder; each keeps a .dependency-cruiser-known-violations.json, which only shrinks).

/** The Krizaka packages that render or carry the design: krizaka-ui's. A krizaka-ui package may depend on krizaka-ts, never the reverse. */
const RENDERING =
  "^(node_modules/)?@krizaka/(ui|tokens|fonts|icons|tailwind|charts|email)(/|$)|(^|/)node_modules/@krizaka/(ui|tokens|fonts|icons|tailwind|charts|email)(/|$)";

// `packages/time` is the dates facade (krizaka-ts#76): the one package that may import the date library. Each package is cruised
// from its own folder (scripts/deps.mjs), so the facade is the run whose folder is `time`.
const facade = require("node:path").basename(process.cwd()) === "time";
const preset = require("@krizaka/config/dependency-cruiser").withOptions({ exemptFrom: facade ? ["^src/"] : [] });

module.exports = {
  forbidden: [
    ...preset.forbidden,
    {
      name: "krizaka-ts-not-from-ui",
      severity: "error",
      comment:
        "Krizaka TS never imports what renders (@krizaka/ui, tokens, fonts, icons, tailwind, charts, email): the dependency goes one way, from krizaka-ui to krizaka-ts (ADR-004). Move the shared logic here, or the rendering part to krizaka-ui.",
      from: {},
      to: { path: RENDERING },
    },
  ],
  options: {
    ...preset.options,
    exclude: { path: "(^|/)(dist|coverage)/" },
    // another package is not followed: its own run reports its violations, once.
    doNotFollow: { path: "(^|/)node_modules/|^\\.\\./(?!node_modules)[^/]+/" },
    // pnpm links packages into node_modules/.pnpm/<name>@<version>: keep the link, so a recorded violation names `node_modules/date-fns`, not a version.
    preserveSymlinks: true,
    tsConfig: { fileName: "tsconfig.json" },
  },
};
