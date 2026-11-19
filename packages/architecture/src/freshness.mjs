// Whether a committed layout was made from the files as they are now (krizaka-internal#4184). A layout carries the sha256 of
// every source it was made from — the model, the base, each translation — so a repository that commits its layout proves it
// is current without laying it out again: no parser, no network.
import { createHash } from "node:crypto";

import { LAYOUT_SCHEMA } from "./layout.mjs";

const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const stale = (path, message) => ({ path, message });

/** The problems of one group of hashed sources against the files given now (both ways: changed, absent, not passed). */
function groupProblems(recorded, files) {
  const out = [];
  for (const f of files) {
    const was = recorded.find((r) => r.path === f.path);
    if (!was) out.push(stale(f.path, `the layout was not made from ${f.path}`));
    else if (was.sha256 !== sha256(f.text))
      out.push(stale(f.path, `the layout was made from another ${f.path}: lay it out again`));
  }
  for (const r of recorded)
    if (!files.some((f) => f.path === r.path))
      out.push(stale(r.path, `the layout was made from ${r.path} too: pass it`));
  return out;
}

function translationProblems(recorded, translations) {
  const out = [];
  for (const [locale, file] of Object.entries(translations)) {
    const was = recorded[locale];
    if (!was) out.push(stale(file.path, `the layout has no ${locale} translation`));
    else if (was.path !== file.path || was.sha256 !== sha256(file.text))
      out.push(stale(file.path, `the layout was made from another ${file.path}: lay it out again`));
  }
  return out;
}

/**
 * What makes a committed layout stale, given the files now: `{ model, base?, translations? }` (`base` and `translations` are
 * compared only when passed). An empty list means the layout was made from exactly these files.
 * @returns {{ path: string, message: string }[]}
 */
export function staleSources(layout, { model, base, translations }) {
  if (layout?.schema !== LAYOUT_SCHEMA || !layout.sources)
    return [stale("", `the file is not a ${LAYOUT_SCHEMA} layout`)];
  return [
    ...groupProblems(layout.sources.model, model),
    ...(base ? groupProblems(layout.sources.base, base) : []),
    ...(translations ? translationProblems(layout.translations ?? {}, translations) : []),
  ];
}
