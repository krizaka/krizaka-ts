---
"@krizaka/config": minor
---

ast-grep: four rules of the coding standard (the `krizaka-engineering` skill). Core: `no-long-function` (a function body over 60 lines), `no-hand-money-math` (`cents / 100`, `amount * 100`: `formatMoney` of @krizaka/intl), `no-hand-intl-format` (`new Intl.DateTimeFormat` / `NumberFormat`, `toLocaleDateString`: @krizaka/intl). Web: `no-raw-fetch-in-client` (`fetch` in a `"use client"` file: `krizakaFetch` in `useQuery` / `useMutation` of @krizaka/query). A repository records each at its count when it bumps (`npx krizaka-sg-ratchet --update`); the counts only go down.
