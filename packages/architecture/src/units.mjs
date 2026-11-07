// The units of one repository, read from its manifests with their own parsers (ADR-026: no regex over a structured format).
// A unit is a package.json of the workspace, a module of the Maven reactor, a crate or a Python project; each carries the org
// dependencies it declares (`@krizaka/*`, `com.krizaka*`, `krizaka-*` crates, `krizaka*` Python packages) with the version
// that builds it: the lockfile's for npm, the pin otherwise.
import { XMLParser } from "fast-xml-parser";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";

import { asc } from "./order.mjs";

const NPM_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
const CARGO_FIELDS = ["dependencies", "dev-dependencies", "build-dependencies"];
const SKIPPED_DIRS = new Set([
  "node_modules",
  "target",
  "dist",
  "build",
  ".next",
  "fixtures",
  "__fixtures__",
  "vendor",
]);
const PLAIN = /^(?:\^|~|>=)?(\d+\.\d+\.\d+)$/;
const PEP508_NAME = /^[A-Za-z0-9][\w.-]*/;
const PROPERTY = /^\$\{([\w.-]+)\}$/;
const NODE_MODULES = "node_modules/";
const xml = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  isArray: (name) => name === "module" || name === "dependency",
});

/** Is a package an org package, per ecosystem? Maven ids are `groupId:artifactId`. */
export const isOrgPackage = {
  npm: (name) => name.startsWith("@krizaka/"),
  maven: (id) => id.startsWith("com.krizaka:") || id.startsWith("com.krizaka."),
  cargo: (name) => name.startsWith("krizaka-"),
  python: (name) => name.toLowerCase().startsWith("krizaka"),
};

/** "0.19.0" from "^0.19.0", "~0.19.0", ">=0.19.0" or "0.19.0"; null for `workspace:`, tags, git or complex ranges. */
export const baseVersion = (range) => PLAIN.exec(String(range ?? "").trim())?.[1] ?? null;

const dirOf = (path) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".");
const joinPath = (dir, rel) => (dir === "." ? rel : `${dir}/${rel}`).replaceAll("/./", "/").replace(/\/$/, "");
const skipped = (path) => path.split("/").some((part) => SKIPPED_DIRS.has(part));
const byKey = (key) => (a, b) => asc(a[key] ?? "", b[key] ?? "");
const manifestsNamed = (files, name) =>
  [...files.keys()].filter((p) => (p === name || p.endsWith(`/${name}`)) && !skipped(p)).sort(asc);

function safely(parse, text) {
  try {
    return parse(text);
  } catch {
    return null;
  }
}

const parseJson = (text) => safely(JSON.parse, text ?? "");

/** Does a directory match a workspace glob (`apps/*`, `packages/**`, `deploy/backup`)? */
export function globMatches(glob, dir) {
  const want = glob.replace(/^\.\//, "").replace(/\/$/, "").split("/");
  const have = dir.split("/");
  const walk = (i, j) => {
    if (i === want.length) return j === have.length;
    if (want[i] === "**") return [...new Array(have.length - j + 1).keys()].some((k) => walk(i + 1, j + k));
    return j < have.length && (want[i] === "*" || want[i] === have[j]) && walk(i + 1, j + 1);
  };
  return walk(0, 0);
}

function workspaceGlobs(files) {
  const pnpm = safely(parseYaml, files.get("pnpm-workspace.yaml") ?? "");
  const root = parseJson(files.get("package.json"));
  const fromRoot = Array.isArray(root?.workspaces) ? root.workspaces : root?.workspaces?.packages;
  return (pnpm?.packages ?? fromRoot ?? []).filter((g) => typeof g === "string");
}

/** Versions by unit path and package, filled once per pair. */
class Locked {
  #map = new Map();
  put(unit, name, version) {
    if (!isOrgPackage.npm(name) || !baseVersion(version)) return;
    const byName = this.#map.get(unit) ?? new Map();
    if (!byName.has(name)) byName.set(name, version);
    this.#map.set(unit, byName);
  }
  /** A unit's lookup: its own version, else the root's (a package hoisted at the root builds every workspace). */
  of(unit) {
    const own = this.#map.get(unit);
    const root = this.#map.get(".");
    return { get: (name) => own?.get(name) ?? root?.get(name) };
  }
}

function lockedByPnpm(text, locked) {
  const importers = safely(parseYaml, text ?? "")?.importers ?? {};
  for (const [unit, importer] of Object.entries(importers)) {
    const entries = NPM_FIELDS.flatMap((field) => Object.entries(importer?.[field] ?? {}));
    for (const [name, entry] of entries) {
      const version = typeof entry === "string" ? entry : entry?.version;
      locked.put(unit, name, String(version ?? "").split("(")[0]);
    }
  }
}

function lockedByNpm(text, locked) {
  for (const [where, entry] of Object.entries(parseJson(text)?.packages ?? {})) {
    const at = where.lastIndexOf(NODE_MODULES);
    if (at < 0) continue;
    const unit = at === 0 ? "." : where.slice(0, at - 1);
    if (!unit.includes(NODE_MODULES.slice(0, -1)))
      locked.put(unit, where.slice(at + NODE_MODULES.length), entry?.version);
  }
}

/** The version the npm lockfile resolved, per unit: `pnpm-lock.yaml` importers, then `package-lock.json` packages. */
function lockedVersions(files) {
  const locked = new Locked();
  lockedByPnpm(files.get("pnpm-lock.yaml"), locked);
  lockedByNpm(files.get("package-lock.json"), locked);
  return locked;
}

function npmDeps(pkg, locked) {
  const deps = new Map();
  for (const field of NPM_FIELDS) {
    for (const [name, range] of Object.entries(pkg?.[field] ?? {})) {
      if (!isOrgPackage.npm(name) || deps.has(name)) continue;
      const resolved = locked.get(name) ?? null;
      deps.set(name, {
        ecosystem: "npm",
        name,
        range: String(range),
        have: resolved ?? baseVersion(range),
        from: resolved ? "lockfile" : "range",
        dev: field === "devDependencies",
      });
    }
  }
  return [...deps.values()].sort(byKey("name"));
}

/** The npm units: the root package.json and every package.json the workspace globs name. */
function npmUnits(files) {
  const globs = workspaceGlobs(files);
  const include = globs.filter((g) => !g.startsWith("!"));
  const exclude = globs.filter((g) => g.startsWith("!")).map((g) => g.slice(1));
  const member = (dir) =>
    dir === "." || (include.some((g) => globMatches(g, dir)) && !exclude.some((g) => globMatches(g, dir)));
  const locked = lockedVersions(files);
  const units = [];
  for (const path of manifestsNamed(files, "package.json")) {
    const dir = dirOf(path);
    const pkg = member(dir) ? parseJson(files.get(path)) : null;
    if (!pkg) continue;
    const typed = files.has(joinPath(dir, "tsconfig.json")) || files.has("tsconfig.json");
    units.push({
      path: dir,
      manifest: path,
      ecosystem: "npm",
      language: typed ? "typescript" : "javascript",
      name: pkg.name ?? null,
      version: pkg.version ?? null,
      published: Boolean(pkg.name) && pkg.private !== true && isOrgPackage.npm(pkg.name),
      dependsOn: npmDeps(pkg, locked.of(dir)),
    });
  }
  return units;
}

const text = (value) => (value === undefined || value === null ? null : String(value).trim());
const listOf = (value) => (Array.isArray(value) ? value : [value].filter(Boolean));

function resolveProperty(value, props) {
  const ref = PROPERTY.exec(value ?? "");
  return ref ? text(props[ref[1]]) : text(value);
}

/** The artifactId of every `<dependency>` anywhere in a parsed POM (dependencies, management, plugins, profiles). */
function everyDependency(node, out = []) {
  if (Array.isArray(node)) node.forEach((child) => everyDependency(child, out));
  else if (node && typeof node === "object") {
    for (const [key, child] of Object.entries(node)) {
      if (key === "dependency") listOf(child).forEach((d) => d?.artifactId && out.push(text(d.artifactId)));
      everyDependency(child, out);
    }
  }
  return out;
}

function mavenDep(id, version, extra = {}) {
  return {
    ecosystem: "maven",
    name: id,
    range: version ?? "managed",
    have: baseVersion(version),
    from: "range",
    dev: false,
    ...extra,
  };
}

function pomDeps(project, parent) {
  const props = project.properties ?? {};
  // A BOM's managed list is not a dependency; an imported BOM is.
  const imported = listOf(project.dependencyManagement?.dependencies?.dependency).filter(
    (d) => text(d.scope) === "import",
  );
  const deps = new Map();
  for (const dep of [...listOf(project.dependencies?.dependency), ...imported]) {
    const id = `${resolveProperty(text(dep.groupId), props)}:${text(dep.artifactId)}`;
    if (isOrgPackage.maven(id) && !deps.has(id))
      deps.set(id, mavenDep(id, resolveProperty(text(dep.version), props), { dev: text(dep.scope) === "test" }));
  }
  if (parent && isOrgPackage.maven(parent.id))
    deps.set(parent.id, mavenDep(parent.id, parent.version, { parent: true }));
  return [...deps.values()].sort(byKey("name"));
}

/**
 * One pom.xml: its coordinates (`id` is `groupId:artifactId`), description, packaging, modules, the org dependencies (an
 * imported BOM and the org parent included) and the artifactId of every dependency it names. null when it does not parse.
 */
export function readPom(body) {
  const project = safely((t) => xml.parse(t), body ?? "")?.project;
  if (!project || typeof project !== "object") return null;
  const parent = project.parent
    ? {
        id: `${text(project.parent.groupId)}:${text(project.parent.artifactId)}`,
        version: text(project.parent.version),
      }
    : null;
  const groupId = text(project.groupId) ?? text(project.parent?.groupId);
  return {
    id: `${groupId}:${text(project.artifactId)}`,
    artifactId: text(project.artifactId),
    description: text(project.description) ?? "",
    version: text(project.version) ?? parent?.version ?? null,
    packaging: text(project.packaging) ?? "jar",
    modules: listOf(project.modules?.module).map(text).filter(Boolean),
    dependsOn: pomDeps(project, parent),
    dependencyIds: everyDependency(project),
  };
}

/** The Maven units: the root pom.xml and its modules, recursively (a module whose pom is not in the files is left out). */
function mavenUnits(files) {
  const units = [];
  const seen = new Set();
  const visit = (dir) => {
    const manifest = joinPath(dir, "pom.xml");
    if (seen.has(manifest) || !files.has(manifest)) return;
    seen.add(manifest);
    const pom = readPom(files.get(manifest));
    if (!pom) return;
    units.push({
      path: dir,
      manifest,
      ecosystem: "maven",
      language: "java",
      name: pom.id,
      version: pom.version,
      packaging: pom.packaging,
      published: isOrgPackage.maven(pom.id),
      dependsOn: pom.dependsOn,
      modules: pom.modules.map((m) => joinPath(dir, m)),
    });
    pom.modules.forEach((m) => visit(joinPath(dir, m)));
  };
  visit(".");
  return units;
}

function cargoRange(spec) {
  if (typeof spec === "string") return spec;
  return String(spec?.version ?? spec?.tag ?? spec?.rev ?? "git");
}

function cargoDeps(manifest) {
  const deps = new Map();
  for (const field of CARGO_FIELDS) {
    for (const [name, spec] of Object.entries(manifest?.[field] ?? {})) {
      if (!isOrgPackage.cargo(name) || deps.has(name)) continue;
      const range = cargoRange(spec);
      const dev = field === "dev-dependencies";
      deps.set(name, {
        ecosystem: "cargo",
        name,
        range,
        have: baseVersion(range.replace(/^v/, "")),
        from: "range",
        dev,
      });
    }
  }
  return [...deps.values()].sort(byKey("name"));
}

/** The crates: every Cargo.toml with a [package] (a bare [workspace] root is not a unit). */
function cargoUnits(files) {
  const units = [];
  for (const path of manifestsNamed(files, "Cargo.toml")) {
    const pkg = safely(parseToml, files.get(path) ?? "")?.package;
    if (!pkg?.name) continue;
    units.push({
      path: dirOf(path),
      manifest: path,
      ecosystem: "cargo",
      language: "rust",
      name: pkg.name,
      version: typeof pkg.version === "string" ? pkg.version : null,
      published: isOrgPackage.cargo(pkg.name) && pkg.publish !== false,
      dependsOn: cargoDeps(safely(parseToml, files.get(path))),
    });
  }
  return units;
}

function pythonDeps(lines) {
  const deps = new Map();
  for (const line of lines.map((l) => String(l).trim())) {
    const name = PEP508_NAME.exec(line)?.[0];
    if (!name || !isOrgPackage.python(name) || deps.has(name)) continue;
    deps.set(name, {
      ecosystem: "python",
      name,
      range: line.slice(name.length).trim(),
      have: null,
      from: "range",
      dev: false,
    });
  }
  return [...deps.values()].sort(byKey("name"));
}

const pythonUnit = (path, name, version, dependsOn) => ({
  path: dirOf(path),
  manifest: path,
  ecosystem: "python",
  language: "python",
  name,
  version,
  published: Boolean(name) && isOrgPackage.python(name),
  dependsOn,
});

/** The Python projects: every pyproject.toml with a [project], else a requirements.txt in a folder of its own. */
function pythonUnits(files) {
  const units = [];
  for (const path of manifestsNamed(files, "pyproject.toml")) {
    const project = safely(parseToml, files.get(path) ?? "")?.project;
    if (project?.name)
      units.push(pythonUnit(path, project.name, project.version ?? null, pythonDeps(project.dependencies ?? [])));
  }
  const dirs = new Set(units.map((u) => u.path));
  for (const path of manifestsNamed(files, "requirements.txt").filter((p) => !dirs.has(dirOf(p)))) {
    units.push(pythonUnit(path, null, null, pythonDeps((files.get(path) ?? "").split("\n"))));
  }
  return units;
}

/** Every unit of a repository, sorted by path then ecosystem: the same files give the same list. */
export function unitsOf(files) {
  return [...npmUnits(files), ...mavenUnits(files), ...cargoUnits(files), ...pythonUnits(files)].sort(
    (a, b) => asc(a.path, b.path) || asc(a.ecosystem, b.ecosystem),
  );
}
