// The three C4 levels (context, containers, components) from the facts of a checkout: `{ level, nodes, edges }` each.
import { contextOf } from "./imports.mjs";
import { asc } from "./order.mjs";
import { componentOf, containerOfPath, scan } from "./scan.mjs";

export const SCHEMA = "krizaka.c4/1";
const FILE_CAP = 200;
const EDGE_FILE_CAP = 20;
const EXTERNALS = {
  DATABASE: "Database",
  AUTH: "Identity provider",
  MEDIA: "Media storage and CDN",
  MAIL: "Mail provider",
  PUSH: "Push notifications",
  PAYMENTS: "Payments provider",
  REALTIME: "Realtime service",
  ABUSE: "Abuse protection",
  OBSERVABILITY: "Observability",
  AI: "AI provider",
};
const LIBRARIES = "external:krizaka-libraries";
const byId = (a, b) => asc(a.id, b.id);

const node = (id, level, kind, name, extra = {}) => {
  const files = [...new Set(extra.files ?? [])].sort(asc);
  return { id, level, kind, name, description: extra.description ?? "", technology: extra.technology, files: files.slice(0, FILE_CAP), fileCount: extra.fileCount ?? files.length };
};

/** Edges merged by (from, to, label): the number of files behind it and the first of them. */
class Edges {
  #map = new Map();
  add(from, to, label, files) {
    const key = `${from}|${to}|${label}`;
    const edge = this.#map.get(key) ?? { from, to, label, count: 0, files: [] };
    edge.count += files.length;
    edge.files = [...new Set([...edge.files, ...files])].sort(asc).slice(0, EDGE_FILE_CAP);
    this.#map.set(key, edge);
  }
  list() {
    return [...this.#map.values()].sort((a, b) => `${a.from}|${a.to}|${a.label}`.localeCompare(`${b.from}|${b.to}|${b.label}`));
  }
}

const containerId = (c) => `container:${c.name}`;
const componentId = (c, name) => `component:${c.name}/${name}`;
const externalId = (ctx) => `external:${ctx.toLowerCase()}`;

/** Env names by external context, with the declaring files, per container dir: `Map<dir, Map<context, { names, files }>>`. */
function putUse(use, dir, name, path) {
  const ctx = contextOf(name);
  if (!EXTERNALS[ctx]) return;
  const byCtx = use.get(dir) ?? new Map();
  const entry = byCtx.get(ctx) ?? { names: new Set(), files: new Set() };
  entry.names.add(name);
  entry.files.add(path);
  byCtx.set(ctx, entry);
  use.set(dir, byCtx);
}

function envUse(facts) {
  const use = new Map();
  for (const d of facts.declarations) d.names.forEach((n) => putUse(use, d.container, n, d.path));
  for (const f of facts.files) f.envs.forEach((n) => putUse(use, f.container, n, f.path));
  return use;
}

const externalNodes = (use) => {
  const agg = new Map();
  for (const byCtx of use.values()) {
    for (const [ctx, { names, files }] of byCtx) {
      const entry = agg.get(ctx) ?? { names: new Set(), files: new Set() };
      names.forEach((n) => entry.names.add(n));
      files.forEach((f) => entry.files.add(f));
      agg.set(ctx, entry);
    }
  }
  return [...agg].map(([ctx, { names, files }]) => node(externalId(ctx), "external", "external", EXTERNALS[ctx], { description: `Configured by ${[...names].sort(asc).join(", ")}`, files }));
};

const workspaceByName = (containers) => new Map(containers.map((c) => [c.name, c]));
const isLibrary = (name, byName) => name.startsWith("@krizaka/") && !byName.has(name);

/** Container -> container edges (declared dependency or import) and container -> library/external edges. */
function containerEdges(facts, use) {
  const edges = new Edges();
  const byName = workspaceByName(facts.containers);
  for (const c of facts.containers) {
    for (const dep of c.deps) {
      if (byName.has(dep) && dep !== c.name) edges.add(containerId(c), containerId(byName.get(dep)), "uses", [c.manifest]);
      else if (isLibrary(dep, byName)) edges.add(containerId(c), LIBRARIES, "uses", [c.manifest]);
    }
  }
  for (const f of facts.files) {
    const from = facts.containers.find((c) => c.dir === f.container);
    for (const imp of f.imports.filter((i) => i.kind === "package")) {
      if (byName.has(imp.name) && imp.name !== from.name) edges.add(containerId(from), containerId(byName.get(imp.name)), "uses", [f.path]);
    }
  }
  for (const [dir, byCtx] of use) {
    const from = facts.containers.find((c) => c.dir === dir);
    for (const [ctx, { files }] of byCtx) edges.add(containerId(from), externalId(ctx), "reads", [...files]);
  }
  return edges;
}

const libraryNode = (facts) => {
  const byName = workspaceByName(facts.containers);
  const used = new Set([...facts.containers.flatMap((c) => c.deps), ...facts.files.flatMap((f) => f.imports.filter((i) => i.kind === "package").map((i) => i.name))].filter((n) => isLibrary(n, byName)));
  return used.size ? [node(LIBRARIES, "external", "external", "Krizaka libraries", { description: [...used].sort(asc).join(", ") })] : [];
};

const containerNodes = (facts) => facts.containers.map((c) => {
  const own = facts.files.filter((f) => f.container === c.dir).map((f) => f.path);
  return node(containerId(c), "container", c.kind, c.name, { description: c.description, technology: c.technology, files: [c.manifest, ...own], fileCount: own.length + 1 });
});

const containerLevel = (facts, use) => {
  const used = new Set([...use.values()].flatMap((m) => [...m.keys()]));
  const externals = externalNodes(use).filter((n) => used.has(n.id.slice("external:".length).toUpperCase()));
  return { level: "containers", nodes: [...containerNodes(facts), ...externals, ...libraryNode(facts)].sort(byId), edges: containerEdges(facts, use).list() };
};

const contextLevel = (facts, use, containers) => {
  const system = node(`system:${facts.repo}`, "system", "system", facts.repo, { description: `${facts.containers.length} container(s)`, files: facts.containers.map((c) => c.manifest) });
  const edges = new Edges();
  for (const e of containers.edges.filter((x) => x.to.startsWith("external:"))) edges.add(system.id, e.to, e.label, e.files);
  const externals = containers.nodes.filter((n) => n.level === "external");
  return { level: "context", nodes: [system, ...externals].sort(byId), edges: edges.list() };
};

const componentNodes = (facts) => {
  const groups = new Map();
  for (const f of facts.files) {
    const c = facts.containers.find((x) => x.dir === f.container);
    const id = componentId(c, f.component);
    const g = groups.get(id) ?? { c, name: f.component, files: [] };
    g.files.push(f.path);
    groups.set(id, g);
  }
  return [...groups].map(([id, g]) => node(id, "component", "component", g.name, { description: g.c.name, technology: g.c.technology, files: g.files }));
};

/** The edge one import of a file draws from its component: to another container, or to another component of the same one. */
function importEdge(facts, byName, c, from, imp) {
  if (imp.kind === "package") {
    return byName.has(imp.name) && imp.name !== c.name ? [from, containerId(byName.get(imp.name)), "uses"] : undefined;
  }
  const target = containerOfPath(facts.containers, imp.target);
  if (target?.dir !== c.dir) return undefined;
  const to = componentId(c, componentOf(c, imp.target));
  return to === from ? undefined : [from, to, "imports"];
}

function componentEdges(facts, use) {
  const edges = new Edges();
  const byName = workspaceByName(facts.containers);
  for (const f of facts.files) {
    const c = facts.containers.find((x) => x.dir === f.container);
    const from = componentId(c, f.component);
    for (const imp of f.imports) {
      const edge = importEdge(facts, byName, c, from, imp);
      if (edge) edges.add(...edge, [f.path]);
    }
    for (const n of f.envs.filter((name) => use.get(f.container)?.has(contextOf(name)))) edges.add(from, externalId(contextOf(n)), "reads", [f.path]);
  }
  return edges;
}

const componentLevel = (facts, use, containers) => {
  const edges = componentEdges(facts, use).list();
  const wanted = new Set(edges.flatMap((e) => [e.from, e.to]));
  const refs = containers.nodes.filter((n) => wanted.has(n.id));
  return { level: "components", nodes: [...componentNodes(facts), ...refs].sort(byId), edges };
};

/** The C4 view of a checkout: `{ schema, repo, levels: { context, containers, components } }`, deterministic. */
export function buildC4(root) {
  const facts = scan(root);
  const use = envUse(facts);
  const containers = containerLevel(facts, use);
  return { schema: SCHEMA, repo: facts.repo, levels: { context: contextLevel(facts, use, containers), containers, components: componentLevel(facts, use, containers) } };
}
