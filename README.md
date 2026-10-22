# Krizaka TS

TypeScript backend building blocks for every Krizaka product, like [Krizaka Java](https://java.krizaka.com): one implementation, no
copies. Published on npm under `@krizaka/` (Apache-2.0).

| Package | What it is |
| --- | --- |
| [`@krizaka/organize`](packages/organize) | A name, an avatar, a description, tags, collections and an undeletable default collection for any entity |

Decision: [ADR-006](https://github.com/krizaka/.github/blob/main/docs/adr/ADR-006-krizaka-ts-organize.md). Contract for contributors and agents: [AGENTS.md](AGENTS.md).

```bash
pnpm install
pnpm run check      # lint · typecheck · tests
```
