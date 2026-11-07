// The facts of a repository's files: its containers (workspace packages or Maven modules) with the unit each one is, its source
// files with what each imports and reads.
import { posix } from "node:path";

import { classify, jsonOf, mavenModules, textOf, workspaceDirs } from "./files.mjs";
import { envNamesOf, localTarget, packageOf, specifiersOf } from "./imports.mjs";
import { readPom, unitsOf } from "./units.mjs";

const FRAMEWORKS = [
  ["next", "Next.js", true],
  ["expo", "Expo", true],
  ["react-native", "React Native", true],
  ["vite", "Vite", true],
  ["express", "Express", true],
  ["fastify", "Fastify", true],
  ["hono", "Hono", true],
];

const npmContainer = (files, dir, repo) => {
  const pkg = jsonOf(files, posix.join(dir, "package.json")) ?? {};
  const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
  const framework = FRAMEWORKS.find(([name]) => name in (pkg.dependencies ?? {}));
  const app = /^apps?\//.test(dir) || Boolean(framework?.[2]) || Boolean(pkg.private && pkg.scripts?.start);
  return {
    dir,
    name: pkg.name ?? (dir === "." ? repo : posix.basename(dir)),
    description: pkg.description ?? "",
    kind: app ? "app" : "library",
    technology: framework?.[1] ?? "TypeScript",
    ecosystem: "npm",
    deps: Object.keys(deps),
    manifest: posix.join(dir, "package.json"),
  };
};

const mavenContainer = (files, dir) => {
  const pom = readPom(textOf(files, posix.join(dir, "pom.xml")));
  return {
    dir,
    name: pom?.artifactId ?? posix.basename(dir),
    description: pom?.description ?? "",
    kind: "module",
    technology: "Maven",
    ecosystem: "maven",
    deps: pom?.dependencyIds ?? [],
    manifest: posix.join(dir, "pom.xml"),
  };
};

/** The containers of a repository: workspace packages, else Maven modules, else the root package itself. */
export function containersOf(files, repo) {
  const packages = workspaceDirs(files);
  if (packages.length) return packages.map((d) => npmContainer(files, d, repo));
  const modules = mavenModules(files);
  if (modules.length) return modules.map((d) => mavenContainer(files, d));
  return jsonOf(files, "package.json") ? [npmContainer(files, ".", repo)] : [];
}

const insideOf = (dir, path) => (dir === "." ? path : path.slice(dir.length + 1));

/** The container a repo path belongs to: the deepest directory that contains it. */
export const containerOfPath = (containers, path) =>
  [...containers]
    .sort((a, b) => b.dir.length - a.dir.length)
    .find((c) => c.dir === "." || path.startsWith(`${c.dir}/`));

/** The component of a path inside its container: the first folder under `src/` (or the container root), `root` for loose files. */
export function componentOf(container, path) {
  const segments = insideOf(container.dir, path)
    .replace(/^src\//, "")
    .split("/");
  return segments.length < 2 ? "root" : segments[0];
}

const factsOf = (files, containers, path) => {
  const container = containerOfPath(containers, path);
  if (!container) return undefined;
  const source = textOf(files, path);
  const imports = specifiersOf(source).flatMap((spec) => {
    const name = packageOf(spec);
    if (name) return [{ kind: "package", name }];
    const target = localTarget(spec, path, container.dir);
    return target ? [{ kind: "local", target }] : [];
  });
  return {
    path,
    container: container.dir,
    component: componentOf(container, path),
    imports,
    envs: envNamesOf(source, { declaration: false }),
  };
};

const declarationsOf = (files, containers, paths) =>
  paths.flatMap((path) => {
    const container = containerOfPath(containers, path);
    return container
      ? [{ path, container: container.dir, names: envNamesOf(textOf(files, path), { declaration: true }) }]
      : [];
  });

/** Everything the C4 levels are built from: `name` is the repository's name when its root package.json has none. */
export function scan(files, name) {
  const repo = jsonOf(files, "package.json")?.name ?? name;
  const containers = containersOf(files, repo);
  const found = classify(files);
  return {
    repo,
    containers,
    units: unitsOf(files),
    files: found.code.map((p) => factsOf(files, containers, p)).filter(Boolean),
    declarations: declarationsOf(files, containers, found.env),
    testCount: found.tests.length,
  };
}
