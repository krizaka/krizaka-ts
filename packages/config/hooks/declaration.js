// Why: every repository says what its git hooks check in DATA, not in a script of its own (ADR-026, krizaka-internal#2746).
// What: reads the `krizaka.hooks` field of a package.json into the ordered steps of each hook of the chain. Built-in steps
//   (secrets before a commit, trailers on the message) always run first; the repository adds command steps after them.
// How: `"krizaka": { "hooks": { "pre-push": [{ "name": "check", "run": "pnpm run check" }] } }`. With no declaration, pre-push
//   runs the `precheck` npm script when there is one, and nothing otherwise. Pure: no file is read here.
// Owner: platform lane (krizaka-ts, @krizaka/config).

/** The hooks of the chain, in the order git runs them for a change. */
export const HOOKS = /** @type {const} */ (["pre-commit", "commit-msg", "pre-push"]);

/** @typedef {{ name: string, builtin?: string, run?: string, script?: string }} Step */

/** @type {Record<string, Step[]>} */
const BUILTIN = {
  "pre-commit": [{ name: "secrets", builtin: "secrets" }],
  "commit-msg": [{ name: "trailers", builtin: "trailers" }],
  "pre-push": [],
};

/**
 * @param {unknown} manifest a parsed package.json (or nothing)
 * @returns {Record<string, Step[]>}
 */
export function readSteps(manifest) {
  const pkg = /** @type {any} */ (manifest ?? {});
  const declared = pkg.krizaka?.hooks ?? {};
  for (const hook of Object.keys(declared)) {
    if (!HOOKS.includes(/** @type {any} */ (hook))) {
      throw new Error(`krizaka.hooks: unknown hook "${hook}" (known: ${HOOKS.join(", ")})`);
    }
  }
  /** @type {Record<string, Step[]>} */
  const steps = {};
  for (const hook of HOOKS) {
    const own = checked(hook, declared[hook]);
    const fallback =
      hook === "pre-push" && own === undefined && pkg.scripts?.precheck
        ? [{ name: "precheck", script: "precheck" }]
        : [];
    steps[hook] = [...BUILTIN[hook], ...(own ?? fallback)];
  }
  return steps;
}

/**
 * @param {string} hook
 * @param {unknown} list
 * @returns {Step[] | undefined}
 */
function checked(hook, list) {
  if (list === undefined) return undefined;
  if (!Array.isArray(list)) throw new Error(`krizaka.hooks.${hook}: expected a list of { name, run }`);
  const seen = new Set();
  return list.map((item, i) => {
    const where = `krizaka.hooks.${hook}[${i}]`;
    if (typeof item?.name !== "string" || item.name === "") throw new Error(`${where}: "name" is required`);
    if (typeof item.run !== "string" || item.run === "")
      throw new Error(`${where}: "run" is required (the command to run)`);
    if (seen.has(item.name) || BUILTIN[hook].some((b) => b.name === item.name))
      throw new Error(`${where}: duplicate step name "${item.name}"`);
    seen.add(item.name);
    return { name: item.name, run: item.run };
  });
}
