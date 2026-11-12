# @krizaka/mail — agent notes

- **Off production, mail goes only to `mail.allowlist`** (ADR-033, decision 8). `deliver` decides from `settings.environment` (the `mail.environment` setting; never a host name, never a process variable read here): anything but `production` is off production, including empty. Off production a recipient outside the allowlist is refused BEFORE the provider, logged as `not-allowlisted` (hashed, key not claimed); the subject gets `[test <environment>]`. Production ignores the allowlist. Do not add a path that calls a provider without this gate.
- The default allowlist (`test@krizaka.com`, `bonjour@krizaka.com`) is in `MAIL_DEFAULTS`; these are internal test addresses, never published.
- `mailpit` is a provider like the others (`mailpitProvider`, injected `fetch`, base URL from `mail.mailpitUrl`, no key); its tests run against a server bound to 127.0.0.1.
- A new delivery status is a new `mailSchema` migration (the `status` CHECK); version 1 is frozen.
