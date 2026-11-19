// The laid-out views in another language (krizaka-internal#4184). A translation is a JSON object from every string the views
// draw (titles, technologies, descriptions, edge labels) to its words in that language; the geometry is the layout's own, so a
// drawing is the same in every language. A string without its translation, or a translation no view draws, is refused: the
// words stay in step with the model.

/** Every string a list of views draws or says, once each, in the order the views meet them. */
export function stringsOf(views) {
  const out = new Set();
  for (const v of views) {
    out.add(v.title);
    for (const n of v.nodes) for (const s of [n.title, n.technology, n.description]) if (s !== null) out.add(s);
    for (const e of v.edges) if (e.label !== null) out.add(e.label);
  }
  return [...out];
}

const isWords = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.values(value).every((s) => typeof s === "string");

function parseWords(text) {
  try {
    const value = JSON.parse(text);
    return isWords(value) ? value : null;
  } catch {
    return null;
  }
}

const viewIn = (view, say) => ({
  ...view,
  title: say(view.title),
  nodes: view.nodes.map((n) => ({
    ...n,
    title: say(n.title),
    technology: say(n.technology),
    description: say(n.description),
  })),
  edges: view.edges.map((e) => ({ ...e, label: say(e.label) })),
});

/**
 * The views in one language. `file` is `{ path, text }` (a JSON object of strings); `problem(path, message)` builds one refusal.
 * Returns `{ views, problems }`: the problems name every missing and every unused string, or the file that is not an object.
 */
export function translateViews(views, file, problem) {
  const words = parseWords(file.text);
  if (words === null) return { views: [], problems: [problem(file.path, "a translation is an object of strings")] };
  const drawn = stringsOf(views);
  const missing = drawn.filter((s) => !Object.hasOwn(words, s));
  const unused = Object.keys(words).filter((s) => !drawn.includes(s));
  const problems = [
    ...missing.map((s) => problem(file.path, `« ${s} » has no translation`)),
    ...unused.map((s) => problem(file.path, `« ${s} » is translated but no view draws it`)),
  ];
  const say = (s) => (s === null ? null : words[s]);
  return { views: problems.length ? [] : views.map((v) => viewIn(v, say)), problems };
}
