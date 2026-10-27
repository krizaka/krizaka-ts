import { randomUUID } from "node:crypto";

import { expect, it } from "vitest";

import { type ExternalIdentity, FederationError, type IdentityProvider, pkceChallenge } from "./federation";
import { IdentityLinkError, type IdentityLinkStore } from "./identity-links";
import type { SessionStore } from "./sessions";

/** What an `IdentityProvider` adapter is run against: the provider, and a way to make the far side hand out a one-time code. */
export interface ProviderHarness {
  provider: IdentityProvider;
  /** The identity the far side vouches for, as a one-time code the person comes back with (bound to a PKCE challenge when one is given). */
  issue(identity: ExternalIdentity, challenge?: string): string | Promise<string>;
}

export const PERSON: ExternalIdentity = { issuer: "https://accounts.google.com", subject: "1234567890", email: "eric@example.com", emailVerified: true, name: "Éric" };

/** What every IdentityProvider adapter must do: the same behaviour behind the same port. */
export function identityProviderContract(name: string, make: () => ProviderHarness | Promise<ProviderHarness>) {
  it(`${name}: starts a sign-in for each provider and keeps the state`, async () => {
    const { provider } = await make();
    for (const which of ["google", "apple", "facebook"] as const) {
      const started = await provider.start(which, "/fr/account");
      expect(started.url).toContain(which);
      expect(started.state.length).toBeGreaterThan(5);
    }
    const a = await provider.start("google", "/");
    const b = await provider.start("google", "/");
    expect(a.state).not.toBe(b.state);
  });

  it(`${name}: refuses an unknown provider`, async () => {
    const { provider } = await make();
    await expect(provider.start("myspace" as never, "/")).rejects.toMatchObject({ code: "UNKNOWN_PROVIDER" });
  });

  it(`${name}: refuses a return address that leaves the product`, async () => {
    const { provider } = await make();
    for (const bad of ["https://evil.example/", "//evil.example", "javascript:alert(1)", "/ok\\evil", "relative", "/a\nb"]) {
      await expect(provider.start("google", bad), bad).rejects.toMatchObject({ code: "BAD_RETURN_TO" });
    }
  });

  it(`${name}: exchanges a one-time code for the verified identity`, async () => {
    const { provider, issue } = await make();
    expect(await provider.complete(await issue(PERSON))).toEqual(PERSON);
  });

  it(`${name}: a code works once`, async () => {
    const { provider, issue } = await make();
    const code = await issue(PERSON);
    await provider.complete(code);
    await expect(provider.complete(code)).rejects.toMatchObject({ code: "INVALID_CODE" });
  });

  it(`${name}: an unknown code is refused`, async () => {
    const { provider } = await make();
    const error = await provider.complete("nope").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FederationError);
    expect(error).toMatchObject({ code: "INVALID_CODE" });
  });

  it(`${name}: a PKCE flow needs the verifier that made the challenge`, async () => {
    const { provider, issue } = await make();
    const verifier = "v".repeat(64);
    await expect(provider.complete(await issue(PERSON, pkceChallenge(verifier)))).rejects.toMatchObject({ code: "INVALID_CODE" });
    await expect(provider.complete(await issue(PERSON, pkceChallenge(verifier)), { codeVerifier: "w".repeat(64) })).rejects.toMatchObject({ code: "INVALID_CODE" });
    expect(await provider.complete(await issue(PERSON, pkceChallenge(verifier)), { codeVerifier: verifier })).toEqual(PERSON);
  });
}

/** What every IdentityLinkStore adapter must do. `account(n)` gives an account id the adapter accepts. */
export function identityLinkStoreContract(name: string, make: () => IdentityLinkStore | Promise<IdentityLinkStore>, account: (n: number) => string | Promise<string>) {
  const NOW = new Date("2026-10-26T12:00:00Z");
  const subject = () => `sub-${randomUUID()}`;

  it(`${name}: finds a linked identity, and nothing else`, async () => {
    const store = await make();
    const sub = subject();
    expect(await store.find("google", sub)).toBeNull();
    const id = await account(1);
    await store.link(id, "google", sub, NOW);
    expect(await store.find("google", sub)).toBe(id);
    expect(await store.find("apple", sub)).toBeNull();
  });

  it(`${name}: linking twice to the same account is harmless`, async () => {
    const store = await make();
    const id = await account(2);
    const sub = subject();
    await store.link(id, "google", sub, NOW);
    await store.link(id, "google", sub, new Date("2026-10-27T12:00:00Z"));
    expect((await store.list(id)).filter((r) => r.subject === sub)).toHaveLength(1);
  });

  it(`${name}: an identity belongs to one account only`, async () => {
    const store = await make();
    const sub = subject();
    await store.link(await account(3), "google", sub, NOW);
    await expect(store.link(await account(4), "google", sub, NOW)).rejects.toBeInstanceOf(IdentityLinkError);
    expect(await store.find("google", sub)).toBe(await account(3));
  });

  it(`${name}: lists an account's identities, oldest first, and unlinks one`, async () => {
    const store = await make();
    const id = await account(5);
    const [a, b] = [subject(), subject()];
    await store.link(id, "apple", b, new Date("2026-10-27T12:00:00Z"));
    await store.link(id, "google", a, NOW);
    expect((await store.list(id)).map((r) => r.subject)).toEqual([a, b]);
    expect(await store.unlink(await account(6), "google", a)).toBe(false);
    expect(await store.unlink(id, "google", a)).toBe(true);
    expect(await store.unlink(id, "google", a)).toBe(false);
    expect(await store.find("google", a)).toBeNull();
  });
}

/** What a `SessionStore` adapter is run against: the store, an active account of the product, and a way to suspend it. */
export interface SessionStoreHarness {
  /** The store; the account it carries is `{ id }`. */
  store: SessionStore<{ id: string }>;
  /** An active account's id (the same `n` gives the same account). */
  account(n: number): string | Promise<string>;
  /** Suspends the account: its sessions no longer sign anybody in. */
  suspend(accountId: string): void | Promise<void>;
}

const NOW = new Date("2026-10-26T12:00:00Z");
const hours = (h: number) => {
  const at = new Date(NOW);
  at.setUTCHours(at.getUTCHours() + h);
  return at;
};
const hashOf = () => `contract-hash-${randomUUID()}`;

/** What every `SessionStore` adapter must do: the same behaviour behind the same port. */
export function sessionStoreContract(name: string, make: () => SessionStoreHarness | Promise<SessionStoreHarness>) {
  it(`${name}: finds a session by its hash with its account, until it expires`, async () => {
    const { store, account } = await make();
    const accountId = await account(1);
    const tokenHash = hashOf();
    await store.insert({ accountId, tokenHash, createdAt: NOW, expiresAt: hours(24), ip: "203.0.113.7", userAgent: "test" });
    const found = await store.find(tokenHash, hours(1));
    expect(found?.account).toEqual({ id: accountId });
    expect(found?.id).toBeTruthy();
    expect(await store.find(tokenHash, hours(24))).toBeNull();
    expect(await store.find(tokenHash, hours(48))).toBeNull();
  });

  it(`${name}: knows no session for an unknown hash`, async () => {
    const { store } = await make();
    expect(await store.find("nope", NOW)).toBeNull();
  });

  it(`${name}: deletes a session, and only that one`, async () => {
    const { store, account } = await make();
    const accountId = await account(2);
    const a = hashOf();
    const b = hashOf();
    await store.insert({ accountId, tokenHash: a, createdAt: NOW, expiresAt: hours(24), ip: null, userAgent: null });
    await store.insert({ accountId, tokenHash: b, createdAt: NOW, expiresAt: hours(24), ip: null, userAgent: null });
    await store.delete(a);
    expect(await store.find(a, NOW)).toBeNull();
    expect((await store.find(b, NOW))?.account.id).toBe(accountId);
    await store.delete(a); // twice: safe
  });

  it(`${name}: a suspended account signs nobody in, at once`, async () => {
    const { store, account, suspend } = await make();
    const accountId = await account(3);
    const tokenHash = hashOf();
    await store.insert({ accountId, tokenHash, createdAt: NOW, expiresAt: hours(24), ip: null, userAgent: null });
    expect(await store.find(tokenHash, NOW)).not.toBeNull();
    await suspend(accountId);
    expect(await store.find(tokenHash, NOW)).toBeNull();
  });

  it(`${name}: refuses the same hash twice`, async () => {
    const { store, account } = await make();
    const accountId = await account(4);
    const tokenHash = hashOf();
    await store.insert({ accountId, tokenHash, createdAt: NOW, expiresAt: hours(24), ip: null, userAgent: null });
    await expect(store.insert({ accountId, tokenHash, createdAt: NOW, expiresAt: hours(24), ip: null, userAgent: null })).rejects.toThrow();
  });
}
