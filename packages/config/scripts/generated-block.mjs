// The generated block of an ast-grep rule file: one regex between two marker lines, rewritten by a generator script.

/**
 * The `block` and `render` of a rule whose regex lives between `begin` and `end`.
 * @param {string} begin the opening marker line
 * @param {string} end the closing marker line
 * @param {string} rule the rule file, named in the error when its markers are missing
 */
export function generatedBlock(begin, end, rule) {
  const block = (/** @type {string[]} */ names) => `${begin}\n    regex: ^(${names.join("|")})$\n    ${end}`;
  /** The rule file with its generated block replaced by the one of `names`. */
  const render = (/** @type {string} */ source, /** @type {string[]} */ names) => {
    const start = source.indexOf(begin);
    const stop = source.indexOf(end);
    if (start < 0 || stop < start) throw new Error(`${rule}: the generated markers are missing`);
    return source.slice(0, start) + block(names) + source.slice(stop + end.length);
  };
  return { block, render };
}
