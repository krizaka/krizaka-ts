---
"@krizaka/config": minor
---

Two rules in the `web` set make every app use `@krizaka/ui`: `no-raw-control` (a raw `<button>`, `<input>`, `<select>`, `<textarea>`, `<table>` or `<dialog>` is refused, the message names the component to import) and `no-local-ui-copy` (a component declared locally under a name `@krizaka/ui` exports is refused; the names are generated from its exports with `pnpm run gen:ui-names`). A legitimate case takes a written `// ui-allow: <reason>`. Refs krizaka-internal#3569.
