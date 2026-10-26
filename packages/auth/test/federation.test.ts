import { describe, expect, it } from "vitest";

import { createFederatedSignIn, type ExternalIdentity, FEDERATED_REFUSAL, type FederatedAccounts, identityLinksMigration, memoryIdentityLinks, memoryIdentityProvider, parseExternalIdentity, pkceChallenge, usersIdentityProvider } from "../src";
import { identityLinkStoreContract, identityProviderContract, PERSON } from "../src/testkit";

describe("in-memory identity provider", () => {
  identityProviderContract("memory", () => {
    const provider = memoryIdentityProvider();
    return { provider, issue: (identity, challenge) => provider.issue(identity, challenge) };
  });
});

/** krizaka-users as the adapter expects it: the exchange body in, the identity (or a 400) out. */
function fakeUsers() {
  const codes = new Map<string, { identity: ExternalIdentity; challenge: string | null }>();
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  let n = 0;
  const refused = { ok: false, status: 400, json: async () => ({ error: "invalid_grant" }) };
  const fetch = async (url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { code: string; code_verifier?: string };
    calls.push({ url, body });
    const entry = codes.get(body.code);
    codes.delete(body.code);
    if (!entry) return refused;
    if (entry.challenge && (!body.code_verifier || pkceChallenge(body.code_verifier) !== entry.challenge)) return refused;
    const { issuer, subject, email, emailVerified, name } = entry.identity;
    return { ok: true, status: 200, json: async () => ({ issuer, subject, email, email_verified: emailVerified, name }) };
  };
  const issue = (identity: ExternalIdentity, challenge?: string) => {
    n += 1;
    codes.set(`otc-${n}`, { identity, challenge: challenge ?? null });
    return `otc-${n}`;
  };
  return { fetch, calls, issue };
}

describe("krizaka-users identity provider", () => {
  identityProviderContract("krizaka-users", () => {
    const users = fakeUsers();
    return { provider: usersIdentityProvider({ baseUrl: "https://auth.dev.akinaza.com/", appUrl: "https://dev.akinaza.com", fetch: users.fetch }), issue: users.issue };
  });

  it("builds the tenant's start address, with the return address on the product and the PKCE challenge", async () => {
    const users = fakeUsers();
    const provider = usersIdentityProvider({ baseUrl: "https://auth.dev.akinaza.com", appUrl: "https://dev.akinaza.com/", fetch: users.fetch });
    const { url, state } = await provider.start("google", "/fr/account", { codeChallenge: "abc" });
    const parsed = new URL(url);
    expect(`${parsed.origin}${parsed.pathname}`).toBe("https://auth.dev.akinaza.com/api/v1/auth/web/google/start");
    expect(parsed.searchParams.get("return_to")).toBe("https://dev.akinaza.com/fr/account");
    expect(parsed.searchParams.get("state")).toBe(state);
    expect(parsed.searchParams.get("code_challenge")).toBe("abc");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("posts the code to the exchange, and the verifier only when there is one", async () => {
    const users = fakeUsers();
    const provider = usersIdentityProvider({ baseUrl: "https://auth.dev.akinaza.com", appUrl: "https://dev.akinaza.com", fetch: users.fetch });
    await provider.complete(users.issue(PERSON));
    expect(users.calls[0]).toEqual({ url: "https://auth.dev.akinaza.com/api/v1/auth/web/exchange", body: { code: "otc-1" } });
  });

  it("says the service is unavailable on a server error, not that the code is wrong", async () => {
    const provider = usersIdentityProvider({ baseUrl: "https://auth.x", appUrl: "https://x", fetch: async () => ({ ok: false, status: 503, json: async () => ({}) }) });
    await expect(provider.complete("c")).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });

  it("refuses an answer that is not an identity", () => {
    expect(() => parseExternalIdentity({ email: "a@b.c" })).toThrow(/issuer/);
    expect(parseExternalIdentity({ issuer: "i", subject: "s", email: "a@b.c", email_verified: "true" })).toMatchObject({ emailVerified: false });
  });
});

describe("in-memory identity links", () => {
  identityLinkStoreContract("memory", memoryIdentityLinks, (n) => `account-${n}`);
  it("has a migration that is idempotent", () => {
    expect(identityLinksMigration()).toContain("CREATE TABLE IF NOT EXISTS external_identities");
    expect(identityLinksMigration()).toContain("PRIMARY KEY (issuer, subject)");
  });
});

describe("federated sign-in: linking", () => {
  const NOW = new Date("2026-10-26T12:00:00Z");
  function setup(accounts: Record<string, { id: string; emailVerified: boolean }>, open = true) {
    const links = memoryIdentityLinks();
    const created: string[] = [];
    const deps: FederatedAccounts = {
      findByEmail: async (email) => accounts[email] ?? null,
      ...(open ? { create: async (identity) => { created.push(identity.email); return `new-${created.length}`; } } : {}),
    };
    return { signIn: createFederatedSignIn({ links, accounts: deps, clock: { now: () => NOW } }).signIn, links, created };
  }

  it("attaches to the account of that address when both sides verified it", async () => {
    const { signIn, links } = setup({ "eric@example.com": { id: "a1", emailVerified: true } });
    expect(await signIn(PERSON)).toEqual({ status: "signed-in", accountId: "a1", via: "linked" });
    expect(await links.find(PERSON.issuer, PERSON.subject)).toBe("a1");
    expect(await signIn(PERSON)).toEqual({ status: "signed-in", accountId: "a1", via: "link" });
  });

  it("matches the address whatever its case", async () => {
    const { signIn } = setup({ "eric@example.com": { id: "a1", emailVerified: true } });
    expect(await signIn({ ...PERSON, email: " Eric@Example.com " })).toMatchObject({ accountId: "a1" });
  });

  it("never attaches when the provider did not verify the address", async () => {
    const { signIn, links, created } = setup({ "eric@example.com": { id: "a1", emailVerified: true } });
    expect(await signIn({ ...PERSON, emailVerified: false })).toEqual({ status: "refused", code: FEDERATED_REFUSAL.emailNotVerified });
    expect(await signIn({ ...PERSON, email: null })).toEqual({ status: "refused", code: FEDERATED_REFUSAL.emailNotVerified });
    expect(await links.find(PERSON.issuer, PERSON.subject)).toBeNull();
    expect(created).toEqual([]);
  });

  it("never attaches when the product did not verify the address", async () => {
    const { signIn, links, created } = setup({ "eric@example.com": { id: "a1", emailVerified: false } });
    expect(await signIn(PERSON)).toEqual({ status: "refused", code: FEDERATED_REFUSAL.accountEmailUnverified });
    expect(await links.find(PERSON.issuer, PERSON.subject)).toBeNull();
    expect(created).toEqual([]);
  });

  it("creates the account when there is none and registration is open", async () => {
    const { signIn, links, created } = setup({});
    expect(await signIn(PERSON)).toEqual({ status: "signed-in", accountId: "new-1", via: "created" });
    expect(created).toEqual(["eric@example.com"]);
    expect(await links.find(PERSON.issuer, PERSON.subject)).toBe("new-1");
  });

  it("refuses when there is none and registration is closed", async () => {
    const { signIn } = setup({}, false);
    expect(await signIn(PERSON)).toEqual({ status: "refused", code: FEDERATED_REFUSAL.noAccount });
  });

  it("a known link signs in even if the address has changed since", async () => {
    const { signIn, links } = setup({});
    await links.link("a9", PERSON.issuer, PERSON.subject, NOW);
    expect(await signIn({ ...PERSON, email: "other@example.com", emailVerified: false })).toEqual({ status: "signed-in", accountId: "a9", via: "link" });
  });

  it("two providers with the same subject are two identities", async () => {
    const { signIn } = setup({ "eric@example.com": { id: "a1", emailVerified: true } });
    await signIn(PERSON);
    const apple = { ...PERSON, issuer: "https://appleid.apple.com" };
    expect(await signIn(apple)).toMatchObject({ accountId: "a1", via: "linked" });
  });
});
