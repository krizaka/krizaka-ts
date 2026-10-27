---
"@krizaka/config": minor
---

New `krizaka-server-client-boundary` (and `@krizaka/config/server-client-boundary`): the server/client boundary guard every Next.js App Router app owes (yomizaka#457). It walks what the server renders (pages, layouts, routes, then the local modules they import, down to a `"use client"` file) and fails when one imports a function (a lowercase export) from a `"use client"` module of `@krizaka/*`, which crashes the page with React error #441 and which neither unit tests nor `next build` see. `--root`, `--app`, `--alias` (read from tsconfig `@/*`), `--scope`.
