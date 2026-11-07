# @krizaka/architecture

The C4 view of a repository, **generated from its code and its manifests** (krizaka/.github#355; ADR-013: one source per rule set;
ADR-027: the one generator of a repository's current state). It runs on a local checkout or on a map of files and gives the same
output wherever it runs, so the docs, krizaka.com, the org's architecture and the founder cockpit all show the architecture of the
code on `main`, not of what is deployed.

Since 0.2.0 it is **no longer dependency-free**: it reads each manifest with its parser — `yaml` (pnpm workspace and lockfile),
`smol-toml` (Cargo, pyproject) and `fast-xml-parser` (Maven), pinned — because ADR-026 refuses a regex over a structured format.

```bash
npx krizaka-architecture ../my-repo --out c4.json                 # the three levels
npx krizaka-architecture ../my-repo --level containers            # one level, { level, nodes, edges }, on stdout
npx krizaka-architecture ../my-repo --out c4.json --text c4.md    # plus the text version
```

```js
import { buildC4, buildC4FromFiles, toText, unitsOf } from "@krizaka/architecture";
const c4 = buildC4("/path/to/checkout"); // { schema: "krizaka.c4/1", repo, levels: { context, containers, components } }
const same = buildC4FromFiles(files, { name: "my-repo" }); // files: Map<repo-relative path, text>, e.g. from a tarball
const units = unitsOf(files); // every unit with its version and the org dependencies that build it
```

Also exported: `isOrgPackage` (per ecosystem), `baseVersion` (`^0.19.0` → `0.19.0`) and `globMatches` (a workspace glob against
a directory).

## The units and their versions (`unitsOf`)

A unit is what a manifest declares, each with `path`, `manifest`, `ecosystem`, `language`, `name`, `version`, `published` (an org
package others can depend on) and `dependsOn`: its **org dependencies** (`@krizaka/*`, `com.krizaka*`, `krizaka-*` crates,
`krizaka*` Python packages), each with the `range` the manifest says, `have` — the version that builds the unit — and `from`
(`lockfile` or `range`), `dev`, and for Maven `parent`.

| Ecosystem | Units                                                                                                        | The version that builds it                                                                                                     |
| :-------- | :----------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------- |
| npm       | the root `package.json` and every workspace member (`pnpm-workspace.yaml`, `workspaces`; `**` and `!` globs) | `pnpm-lock.yaml` importers, else `package-lock.json` (per workspace, then hoisted at the root), else the range's plain version |
| Maven     | the root `pom.xml` and its `<module>`s, recursively; `packaging` and `modules`                               | the declared version (properties resolved); an imported BOM and the org parent are dependencies, a managed one says `managed`  |
| Cargo     | every `Cargo.toml` with a `[package]` (`publish = false` is not published)                                   | the version, or the git `tag` / `rev`                                                                                          |
| Python    | every `pyproject.toml` with a `[project]`, else a `requirements.txt` in a folder of its own                  | the PEP 508 specifier as the range                                                                                             |

A manifest that does not parse is left out, never thrown. Container nodes of the `containers` level carry their unit's
`ecosystem`, `language`, `version`, `published` and `dependsOn` when the manifest at their directory says one.

## What is read

| Level        | Nodes                                                                                                                                                                                                                                                                | Edges                                                                                                      |
| :----------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------- |
| `context`    | the system (the repo) and what it reaches: external services, Krizaka libraries                                                                                                                                                                                      | system `reads` an external service, `uses` the libraries                                                   |
| `containers` | npm/yarn `workspaces` and `pnpm-workspace.yaml` packages (`app` or `library`; a Next.js, Expo, Vite, Express, Fastify or Hono dependency, or `apps/`, makes an app), Maven `<module>`s, or the root package alone; each with its unit's version and org dependencies | container `uses` another (a declared dependency or an import) and `reads` an external service              |
| `components` | the first folder under `src/` (or the container root) of each container; `root` for loose files                                                                                                                                                                      | component `imports` component (relative and `@/` imports), `uses` a container, `reads` an external service |

External services come from the **env declarations** (`lib/env.ts`, `env.ts`, `.env.example`) and `process.env.X` reads, by the org contexts
(`DATABASE_`, `AUTH_`, `MEDIA_`, `MAIL_`, `PUSH_`, `PAYMENTS_`, `REALTIME_`, `ABUSE_`, `OBSERVABILITY_`, `AI_`): a vendor is a value, so it never
appears (`MAIL_PROVIDER=mailgun` is « Mail provider »). `APP_` and `OPERATOR_` are the app's own settings, not external services.

Every node lists the **files behind it** (repo-relative, capped at 200, `fileCount` is the true number) and every edge the files that
cause it (capped at 20). Tests, stories, `node_modules`, `dist`, `.next`, `target` are left out. The output is deterministic (sorted, no date):
a diff of two runs is a diff of the architecture.

## Calling it from the cockpit (local, private)

The founder cockpit runs it per repo on the Mac and reads `{ nodes, edges, level }`:

```js
import { execFileSync } from "node:child_process";
const level = JSON.parse(
  execFileSync("npx", ["--yes", "@krizaka/architecture", repoPath, "--level", "containers"], { encoding: "utf8" }),
);
```

Not in this package: the intent and the target (the LikeC4 models of each system's home, ADR-027), the joins across repositories
(latest tags, behind, links) and the drawing: the org's architecture assembler in krizaka/.github `tools/architecture/` reads this
package's output for every repository.
