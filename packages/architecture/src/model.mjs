// The LikeC4 model of a C4 built from code (`buildC4`): a specification, the containers as elements, the relations
// between them and one view, `containers`, so a repository gets its drawing without a hand-written model. Pure text out,
// deterministic: ids are positions in the sorted node list, never the package names (which are not identifiers).
import { SCHEMA } from "./c4.mjs";

export const CONTAINERS_VIEW = "containers";

const KINDS = ["app", "library", "module", "external"];
const quote = (text) => `'${String(text).replace(/[\\']/g, (c) => `\\${c}`)}'`;
const firstSentence = (text) => {
  const flat = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const end = flat.search(/[.!?](\s|$)/);
  return end < 0 ? flat : flat.slice(0, end + 1);
};

/** Is this value a C4 as `buildC4` returns it? */
export const isC4 = (value) => typeof value === "object" && value !== null && value.schema === SCHEMA;

/** The LikeC4 text of the containers level of a C4: `[{ path, text }]`, one file. */
export function modelOfC4(c4) {
  const level = c4.levels.containers;
  const ids = new Map(level.nodes.map((n, i) => [n.id, `c${i}`]));
  const lines = ["specification {", ...KINDS.map((k) => `  element ${k}`), "}", "model {"];
  for (const n of level.nodes) {
    const kind = KINDS.includes(n.kind) ? n.kind : "module";
    lines.push(`  ${ids.get(n.id)} = ${kind} ${quote(n.name)} {`);
    const description = firstSentence(n.description);
    if (description) lines.push(`    description ${quote(description)}`);
    if (n.technology) lines.push(`    technology ${quote(n.technology)}`);
    lines.push("  }");
  }
  for (const e of level.edges) {
    if (ids.has(e.from) && ids.has(e.to)) lines.push(`  ${ids.get(e.from)} -> ${ids.get(e.to)} ${quote(e.label)}`);
  }
  lines.push(
    "}",
    "views {",
    `  view ${CONTAINERS_VIEW} {`,
    `    title ${quote(`${c4.repo} · containers`)}`,
    "    include *",
    "  }",
    "}",
    "",
  );
  return [{ path: `${c4.repo}.c4`, text: lines.join("\n") }];
}
