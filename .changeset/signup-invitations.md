---
"@krizaka/auth": minor
---

Invitation-only sign-up: `signupInvitations` and `signupInvitationsSchema`. While sign-up is closed, the administration invites an address to create an account: a link used once (only its keyed hash kept), bound to the invited address, revocable, replaced by a new invitation of the same address, with an optional opaque `grant` handed back at redemption. `redeem` is one atomic statement: of two concurrent redemptions exactly one wins. Refusals are typed (`INVITE_INVALID` for unknown, expired, used or revoked alike).
