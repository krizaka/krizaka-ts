---
"@krizaka/rate-limit": minor
---

`@krizaka/rate-limit/turnstile`: `createTurnstileVerifier` checks a Cloudflare Turnstile token server-side (siteverify) and fails closed: no secret, no token, a refusal, a wrong hostname or action, a replayed token, a timeout or an unreachable service all refuse. Single-use, injected clock and fetch (krizaka-com#464).
