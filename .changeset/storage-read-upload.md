---
"@krizaka/storage": minor
---

`readUpload(request, { field, maxBytes })`: reads one uploaded file from a multipart request — refuses an oversize body from `Content-Length` before reading it, then a missing, empty or too large file (`StorageError` `tooBig` / the new `noFile`). The type stays `Storage.upload`'s to decide, by magic number. Apps no longer hand-roll the size check and the form parsing.
