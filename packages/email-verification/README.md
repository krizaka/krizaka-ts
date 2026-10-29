# @krizaka/email-verification

Proof that a person controls an e-mail address, for every Krizaka **public form** (rule `email-verification` of the org registry: *public e-mail forms verify the address*). The message is **held** and delivered **only after** the code is confirmed (verify first): a bot that types someone else's address costs that person one e-mail and the team nothing.

- a **6-digit code** (`crypto.randomInt`), valid **15 minutes**, **single use**, **5 tries** (then the challenge is destroyed);
- the store keeps only a **salted HMAC** of `id + address + code` and the held payload — never the code, never the address in the clear;
- the proof binds the address: the right code with another address is refused;
- mail texts **EN and FR** (`verificationMail`); the module never sends: the product queues the mail (`@krizaka/mail`, Mailgun, …);
- no environment variable, no wall clock (`now` is injected), no vendor; the secret comes in as a parameter (≥ 32 characters).

```ts
import { createEmailVerification, memoryCodeStore, verificationMail } from "@krizaka/email-verification";

const verification = createEmailVerification({ store: memoryCodeStore(), secret, now: () => new Date() });

// 1. the form is posted (after its CAPTCHA and rate limit): hold the message, mail the code
const { challengeId, code, ttlMinutes } = await verification.issue({ address, payload: message });
await send({ to: address, ...verificationMail({ locale, code, ttlMinutes }) });
// answer { challengeId } — the browser asks for the code

// 2. the visitor returns the code
const result = await verification.confirm<Message>({ challengeId, address, code });
if (result.ok) await deliver(result.payload);          // released once
else /* result.reason: invalid (attemptsLeft) | expired | locked | unknown */;
```

`memoryCodeStore` is right for one instance and for tests (a visitor who lands on another instance, or after a restart, is asked for a new code). A product with several instances implements `CodeStore` (5 methods) and runs `codeStoreContract` from `@krizaka/email-verification/testkit`.

Callers still own the **rate limit of `issue`** (`@krizaka/rate-limit`: per address and per IP, so the code mail cannot be used to flood a mailbox) and the CAPTCHA (`@krizaka/rate-limit/turnstile`).
