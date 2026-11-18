---
"@krizaka/sovkora-client": minor
---

`readPages(pages)` reads document pages through Sovkora's one authenticated door (`POST /api/v1/document-reads`): 1 to 12 pages (`image` bytes, at most 2 MB, and `kind`: `pdf-scan`, `screenshot` or `photo`), checked before any call, and one reading per page back, in order, with its text, its lines and boxes, the reader and version that read it, and what it cost (`costMicros`) and took (`latencyMs`). The reader is Sovkora's routing, never the product's. An edge answer of 413 is now `SOVKORA_INPUT`, like 400 and 422.
