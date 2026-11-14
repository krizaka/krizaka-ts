// Build-time layout of LikeC4 views (krizaka-internal#3671). A model is checked with the org's rules and laid out with
// LikeC4's own parser and Graphviz; what comes back is the geometry a drawing needs (`ArchView`), the hashes of the sources
// and the check's verdict. Deterministic: the same sources give the same JSON. Needs no network and no settings.
import { createHash } from "node:crypto";

import { fromSources } from "@likec4/language-services/node";

import { CONTAINERS_VIEW, isC4, modelOfC4 } from "./model.mjs";

export const LAYOUT_SCHEMA = "krizaka.layout/1";

/** The rules a model is checked against; an `ArchitectureModelError` names the one that failed. */
export const RULES = Object.freeze({
  model: "model",
  specification: "no-specification",
  home: "home",
  views: "views",
});

/** A model the check refuses: `rule` is the first rule that failed, `problems` lists every one. */
export class ArchitectureModelError extends Error {
  constructor(problems) {
    super(
      `the architecture model is refused (${problems[0].rule}):\n${problems.map((p) => `  ${p.path}:${p.line} [${p.rule}] ${p.message}`).join("\n")}`,
    );
    this.name = "ArchitectureModelError";
    this.rule = problems[0].rule;
    this.problems = problems;
  }
}

const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const byPath = (a, b) => Number(a.path > b.path) - Number(a.path < b.path);
/** LikeC4 breaks a long label with a newline for its own drawing; a page wraps words itself. */
const flat = (s) =>
  s == null
    ? null
    : String(s)
        .split("\n")
        .map((line) => line.trim())
        .join(" ");
const textOf = (d) => flat(typeof d === "string" ? d : (d?.txt ?? null));
const stepOf = (id) => {
  const [, n] = id.match(/^step-(\d+)$/) ?? [];
  return n === undefined ? null : Number(n);
};
const MODEL_ROOT = "model/";
const BASE_ROOT = "base/";

/** One laid-out LikeC4 view as the drawing needs it. */
export function viewOf(v) {
  return {
    id: v.id,
    title: v.title,
    dynamic: v._type === "dynamic",
    bounds: v.bounds,
    nodes: v.nodes.map((n) => ({
      id: n.id,
      parent: n.parent ?? null,
      kind: n.kind,
      shape: n.shape,
      title: flat(n.title),
      technology: flat(n.technology),
      description: textOf(n.description),
      compound: (n.children ?? []).length > 0,
      x: Math.round(n.x),
      y: Math.round(n.y),
      width: Math.round(n.width),
      height: Math.round(n.height),
    })),
    edges: v.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: flat(e.label),
      points: e.points.map(([x, y]) => [Math.round(x), Math.round(y)]),
      labelBBox: e.labelBBox ?? null,
      step: stepOf(e.id),
      back: e.dir === "back",
    })),
  };
}

const withHash = (files) => files.map(({ path, text }) => ({ path, text, sha256: sha256(text) })).sort(byPath);
const virtualFiles = (files, root) => files.map((f) => [`${root}${f.path}`, f.text]);

/** Parse virtual files; run `use` on the LikeC4 instance, always disposed. */
async function withModel(files, use) {
  const likec4 = await fromSources(Object.fromEntries(files));
  try {
    return await use(likec4);
  } finally {
    await likec4.dispose();
  }
}

const problemOf = (rule, path, line, message) => ({ rule, path, line, message });

/** The sources as `{ path, text }` lists: a text, a list of files or a C4 built from code. */
function sourcesOf(model) {
  if (typeof model === "string") return [{ path: "model.c4", text: model }];
  if (isC4(model)) return modelOfC4(model);
  if (Array.isArray(model)) return model;
  throw new TypeError("layoutViews takes a LikeC4 text, a list of { path, text } or a C4 from buildC4");
}

/**
 * Check a LikeC4 model with the org's rules and lay its views out.
 *
 * @param model a LikeC4 text, `[{ path, text }]`, or the C4 `buildC4` returns (its containers view is drawn)
 * @param options `base`: the org's files the model is written against (`specification.c4`, `org.c4`), a model then writes
 *   no specification of its own; `system`: the id of the system a model may only extend (every element it adds lives inside);
 *   `views`: the view ids to return, in this order (each must exist), default all but LikeC4's implicit `index`
 * @throws {ArchitectureModelError} when a rule fails; `rule` and `problems` say which
 */
export async function layoutViews(model, options = {}) {
  const base = withHash(options.base ?? []);
  const files = withHash(sourcesOf(model));
  const wanted = options.views ?? (isC4(model) ? [CONTAINERS_VIEW] : null);
  const system = options.system ?? null;
  const known = system && base.length ? await elementIds(base) : new Set();

  const { problems, views, elements } = await withModel(
    [...virtualFiles(base, BASE_ROOT), ...virtualFiles(files, MODEL_ROOT)],
    async (likec4) => {
      const found = [];
      for (const e of likec4.getErrors()) {
        const path = String(e.sourceFsPath ?? "").replace(/^\/workspace\//, "");
        found.push(problemOf(RULES.model, path, e.line ?? 1, e.message));
      }
      if (base.length) {
        for (const doc of likec4.langium.shared.workspace.LangiumDocuments.all.toArray()) {
          if (
            doc.uri.path.startsWith(`/workspace/${MODEL_ROOT}`) &&
            (doc.parseResult.value.specifications ?? []).length
          )
            found.push(
              problemOf(
                RULES.specification,
                doc.uri.path.replace("/workspace/", ""),
                1,
                "a model writes no specification: the org's own is in its base",
              ),
            );
        }
      }
      if (found.length) return { problems: found, views: [], elements: [] };
      const own = [...(await likec4.computedModel()).elements()]
        .map((e) => e.id)
        .filter((id) => !known.has(id))
        .sort();
      if (system)
        for (const id of own.filter((x) => !x.startsWith(`${system}.`)))
          found.push(
            problemOf(
              RULES.home,
              `${MODEL_ROOT}${files[0]?.path ?? ""}`,
              1,
              `« ${id} » is outside the system ${system}: a model only extends its own system`,
            ),
          );
      return { problems: found, views: found.length ? [] : await likec4.diagrams(), elements: own };
    },
  );
  // LikeC4 adds an implicit landscape view, `index`; it is returned only when asked for by name.
  const laid = views.filter((v) => v.id !== "index" || wanted?.includes("index")).map(viewOf);
  const absent = (wanted ?? []).filter((id) => !laid.some((v) => v.id === id));
  if (!problems.length && absent.length)
    problems.push(problemOf(RULES.views, files[0]?.path ?? "", 1, `the model has no view ${absent.join(", ")}`));
  if (problems.length) throw new ArchitectureModelError(problems);

  const likec4Version = (await import("@likec4/language-services/package.json", { with: { type: "json" } })).default
    .version;
  return {
    schema: LAYOUT_SCHEMA,
    tool: { name: "@krizaka/architecture", likec4: likec4Version },
    sources: {
      model: files.map(({ path, sha256: hash }) => ({ path, sha256: hash })),
      base: base.map(({ path, sha256: hash }) => ({ path, sha256: hash })),
    },
    check: { status: "ok", system, errors: [], elements },
    views: wanted ? wanted.map((id) => laid.find((v) => v.id === id)) : laid,
  };
}

async function elementIds(base) {
  return withModel(
    virtualFiles(base, BASE_ROOT),
    async (likec4) => new Set([...(await likec4.computedModel()).elements()].map((e) => e.id)),
  );
}
