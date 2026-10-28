# @krizaka/architecture

The C4 view of a repository, **generated from its code** (krizaka/.github#355, first slice; ADR-013: one source per rule set).
Dependency-free (Node built-ins), it runs on a local checkout and gives the same output wherever it runs, so the docs, krizaka.com and
the founder cockpit all show the architecture of the code, not of what is deployed.

```bash
npx krizaka-architecture ../my-repo --out c4.json                 # the three levels
npx krizaka-architecture ../my-repo --level containers            # one level, { level, nodes, edges }, on stdout
npx krizaka-architecture ../my-repo --out c4.json --text c4.md    # plus the text version
```

```js
import { buildC4, toText } from "@krizaka/architecture";
const c4 = buildC4("/path/to/checkout"); // { schema: "krizaka.c4/1", repo, levels: { context, containers, components } }
```

## What is read

| Level | Nodes | Edges |
| :--- | :--- | :--- |
| `context` | the system (the repo) and what it reaches: external services, Krizaka libraries | system `reads` an external service, `uses` the libraries |
| `containers` | npm/yarn `workspaces` and `pnpm-workspace.yaml` packages (`app` or `library`; a Next.js, Expo, Vite, Express, Fastify or Hono dependency, or `apps/`, makes an app), Maven `<module>`s, or the root package alone | container `uses` another (a declared dependency or an import) and `reads` an external service |
| `components` | the first folder under `src/` (or the container root) of each container; `root` for loose files | component `imports` component (relative and `@/` imports), `uses` a container, `reads` an external service |

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
const level = JSON.parse(execFileSync("npx", ["--yes", "@krizaka/architecture", repoPath, "--level", "containers"], { encoding: "utf8" }));
```

Not in this package yet: SonarQube Architecture (intended architecture and deviations), and rendering on krizaka.com / the docs.
