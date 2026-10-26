import { randomUUID } from "node:crypto";

import { expect, it } from "vitest";

import type { ConsentRecord, PrivacyRequest, PrivacyStore, Subject } from "./port";

const T0 = new Date("2026-10-26T12:00:00.000Z");
const at = (seconds: number) => new Date(T0.valueOf() + seconds * 1000);
const ERIC: Subject = { kind: "account", id: "11111111-1111-4111-8111-111111111111" };
const CLIENT: Subject = { kind: "client", id: "c-42" };

const consent = (subject: Subject, purpose: string, granted: boolean, seconds: number): ConsentRecord => ({ id: randomUUID(), subject, purpose, version: "2026-10-01", granted, means: "checkbox", at: at(seconds) });
const request = (subject: Subject, kind: PrivacyRequest["kind"], seconds: number): PrivacyRequest => ({ id: randomUUID(), subject, kind, status: "requested", requestedAt: at(seconds), completedAt: null, failure: null });

/** What every `PrivacyStore` adapter must do: the same behaviour behind the same port. `make` gives an empty store. */
export function privacyStoreContract(name: string, make: () => PrivacyStore | Promise<PrivacyStore>) {
  it(`${name}: knows nothing about a person who never said anything`, async () => {
    const store = await make();
    expect(await store.latestConsent(ERIC, "marketing")).toBeNull();
    expect(await store.consentHistory(ERIC)).toEqual([]);
  });

  it(`${name}: the consent with the last word wins, and the history keeps every one in order`, async () => {
    const store = await make();
    const first = consent(ERIC, "marketing", true, 0);
    const second = consent(ERIC, "marketing", false, 10);
    const third = consent(ERIC, "marketing", true, 20);
    for (const c of [first, second, third]) await store.insertConsent(c);
    expect(await store.latestConsent(ERIC, "marketing")).toEqual(third);
    expect((await store.consentHistory(ERIC)).map((c) => c.id)).toEqual([first.id, second.id, third.id]);
  });

  it(`${name}: keeps purposes and subjects apart, whatever the kind of subject`, async () => {
    const store = await make();
    await store.insertConsent(consent(ERIC, "marketing", true, 0));
    await store.insertConsent(consent(ERIC, "screening", false, 1));
    await store.insertConsent(consent(CLIENT, "marketing", false, 2));
    expect((await store.latestConsent(ERIC, "marketing"))?.granted).toBe(true);
    expect((await store.latestConsent(ERIC, "screening"))?.granted).toBe(false);
    expect((await store.latestConsent(CLIENT, "marketing"))?.granted).toBe(false);
    expect(await store.consentHistory(CLIENT)).toHaveLength(1);
    expect(await store.latestConsent({ kind: "client", id: ERIC.id }, "marketing")).toBeNull(); // same id, another kind
  });

  it(`${name}: records the proof: the notice version, the means and the instant`, async () => {
    const store = await make();
    const c = { ...consent(ERIC, "marketing", true, 5), version: "v7", means: "link" };
    await store.insertConsent(c);
    const found = await store.latestConsent(ERIC, "marketing");
    expect(found).toMatchObject({ version: "v7", means: "link", granted: true });
    expect(found!.at.toISOString()).toBe(at(5).toISOString());
  });

  it(`${name}: follows a request from asked to completed, or failed with a code`, async () => {
    const store = await make();
    const done = request(ERIC, "export", 0);
    const broke = request(ERIC, "erasure", 10);
    await store.insertRequest(done);
    await store.insertRequest(broke);
    await store.finishRequest(done.id, { status: "completed", at: at(3) });
    await store.finishRequest(broke.id, { status: "failed", at: at(11), failure: "CONTRIBUTOR_FAILED" });
    expect(await store.getRequest(done.id)).toMatchObject({ kind: "export", status: "completed", failure: null });
    expect((await store.getRequest(done.id))!.completedAt!.toISOString()).toBe(at(3).toISOString());
    expect(await store.getRequest(broke.id)).toMatchObject({ kind: "erasure", status: "failed", failure: "CONTRIBUTOR_FAILED" });
    expect(await store.getRequest(randomUUID())).toBeNull();
    expect((await store.requestsOf(ERIC)).map((r) => r.id)).toEqual([broke.id, done.id]); // newest first
    expect(await store.requestsOf(CLIENT)).toEqual([]);
  });
}
