---
"@krizaka/auth": minor
---

`landingRedirect` and `sessionHint` (krizaka-ui#827): the proxy-side rules of « a signed-in person never sees the public side ». A request with the session cookie on the landing route answers 307 to the product's home (`Cache-Control: private, no-store`, `Vary: Cookie`); `sessionHint` keeps a readable `kz-session=1` flag next to the HttpOnly cookie so the static pages' bar draws the signed-in placeholder on its first paint. The cookie is a hint, never an authorization.
