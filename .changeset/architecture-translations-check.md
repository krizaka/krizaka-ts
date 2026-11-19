---
"@krizaka/architecture": minor
---

`layoutViews` takes `translations` (`{ <locale>: { path, text } }`) and returns each language's views with the hash of its file; a string without its translation, or a translation no view draws, is refused (rule `translations`). `staleSources(layout, files)` says whether a committed layout was made from the files as they are now. The CLI: `layout --translations <locale>=file.json` and `check <views.json> --model … [--base …] [--translations …]` (krizaka-internal#4184).
