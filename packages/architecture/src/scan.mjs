// The facts of a checkout: its containers (workspace packages or Maven modules), its source files with what each imports and reads.
import { basename, join, posix, resolve } from "node:path";

import { mavenModules, readJson, readText, walk, workspaceDirs } from "./files.mjs";
import { envNamesOf, localTarget, packageOf, specifiersOf } from "./imports.mjs";

const FRAMEWORKS = [["next", "Next.js", true], ["expo", "Expo", true], ["react-native", "React Native", true], ["vite", "Vite", true], ["express", "Express", true], ["fastify", "Fastify", true], ["hono", "Hono", true]];

const npmContainer = (root, dir) => {
  const pkg = readJson(join(root, dir, "package.json")) ?? {};
  const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
  const framework = FRAMEWORKS.find(([name]) => name in (pkg.dependencies ?? {}));
  const app = /^apps?\//.test(dir) || Boolean(framework?.[2]) || Boolean(pkg.private && pkg.scripts?.start);
  return { dir, name: pkg.name ?? (dir === "." ? basename(resolve(root)) : posix.basename(dir)), description: pkg.description ?? "", kind: app ? "app" : "library", technology: framework?.[1] ?? "TypeScript", deps: Object.keys(deps), manifest: posix.join(dir, "package.json") };
};

const artifactIds = (xml) => [...xml.matchAll(/<artifactId>\s*([^<\s]+)\s*<\/artifactId>/g)].map((m) => m[1]);

const mavenContainer = (root, dir) => {
  const pom = readText(join(root, dir, "pom.xml"));
  const own = artifactIds(pom.replace(/<parent>[\s\S]*?<\/parent>/, "").replace(/<dependencies>[\s\S]*?<\/dependencies>/g, ""))[0];
  const deps = [...pom.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)].flatMap((m) => artifactIds(m[1]).slice(0, 1));
  return { dir, name: own ?? posix.basename(dir), description: /<description>\s*([^<]*?)\s*<\/description>/.exec(pom)?.[1] ?? "", kind: "module", technology: "Maven", deps, manifest: posix.join(dir, "pom.xml") };
};

/** The containers of a checkout: workspace packages, else Maven modules, else the root package itself. */
export function containersOf(root) {
  const packages = workspaceDirs(root);
  if (packages.length) return packages.map((d) => npmContainer(root, d));
  const modules = mavenModules(root);
  if (modules.length) return modules.map((d) => mavenContainer(root, d));
  return readJson(join(root, "package.json")) ? [npmContainer(root, ".")] : [];
}

const insideOf = (dir, path) => (dir === "." ? path : path.slice(dir.length + 1));

/** The container a repo path belongs to: the deepest directory that contains it. */
export const containerOfPath = (containers, path) => [...containers].sort((a, b) => b.dir.length - a.dir.length).find((c) => c.dir === "." || path.startsWith(`${c.dir}/`));

/** The component of a path inside its container: the first folder under `src/` (or the container root), `root` for loose files. */
export function componentOf(container, path) {
  const segments = insideOf(container.dir, path).replace(/^src\//, "").split("/");
  return segments.length < 2 ? "root" : segments[0];
}

const factsOf = (root, containers, path) => {
  const container = containerOfPath(containers, path);
  if (!container) return undefined;
  const source = readText(join(root, path));
  const imports = specifiersOf(source).flatMap((spec) => {
    const name = packageOf(spec);
    if (name) return [{ kind: "package", name }];
    const target = localTarget(spec, path, container.dir);
    return target ? [{ kind: "local", target }] : [];
  });
  return { path, container: container.dir, component: componentOf(container, path), imports, envs: envNamesOf(source, { declaration: false }) };
};

const declarationsOf = (root, containers, paths) => paths.flatMap((path) => {
  const container = containerOfPath(containers, path);
  return container ? [{ path, container: container.dir, names: envNamesOf(readText(join(root, path)), { declaration: true }) }] : [];
});

/** Everything the C4 levels are built from. */
export function scan(root) {
  const repo = readJson(join(root, "package.json"))?.name ?? basename(resolve(root));
  const containers = containersOf(root);
  const found = walk(root);
  const files = found.code.map((p) => factsOf(root, containers, p)).filter(Boolean);
  return { repo, containers, files, declarations: declarationsOf(root, containers, found.env), testCount: found.tests.length };
}
