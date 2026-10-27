import { expect, it } from "vitest";

import type { ApiKeyRecord, ApiKeyStore } from "./port";

/** What every ApiKeyStore adapter must do: the same behaviour behind the same port. `owner(n)` gives an owner the adapter accepts. */
export function apiKeyStoreContract(name: string, make: () => ApiKeyStore | Promise<ApiKeyStore>, owner: (n: number) => string | Promise<string>) {
  const record = (ownerId: string, publicId: string, over: Partial<ApiKeyRecord> = {}): ApiKeyRecord => ({
    id: crypto.randomUUID(),
    ownerId,
    name: "k",
    publicId,
    secretHash: "a".repeat(64),
    scopes: ["checks:write"],
    expiresAt: new Date("2027-01-01T00:00:00Z"),
    createdAt: new Date("2026-10-22T12:00:00Z"),
    lastUsedAt: null,
    revokedAt: null,
    rotatedFromId: null,
    supersededAt: null,
    ...over,
  });
  const pid = () => crypto.randomUUID().replaceAll("-", "").slice(0, 12);

  it(`${name}: stores a record and finds it by id and by its public id, dates and scopes intact`, async () => {
    const store = await make();
    const r = record(await owner(1), pid(), { scopes: ["checks:write", "reports:read"] });
    await store.insert(r);
    expect(await store.get(r.id)).toEqual(r);
    expect(await store.findByPublicId(r.publicId)).toEqual(r);
    expect(await store.get(crypto.randomUUID())).toBeNull();
    expect(await store.findByPublicId("f".repeat(12))).toBeNull();
  });

  it(`${name}: lists one owner's records, oldest first, and no one else's`, async () => {
    const store = await make();
    const [a, b] = [await owner(2), await owner(3)];
    const first = record(a, pid(), { createdAt: new Date("2026-10-01T00:00:00Z") });
    const second = record(a, pid(), { createdAt: new Date("2026-10-02T00:00:00Z") });
    await store.insert(second);
    await store.insert(first);
    await store.insert(record(b, pid()));
    expect((await store.list(a)).map((r) => r.id)).toEqual([first.id, second.id]);
  });

  it(`${name}: updates last use, revocation and supersession`, async () => {
    const store = await make();
    const r = record(await owner(4), pid());
    await store.insert(r);
    const [used, revoked, ends] = [new Date("2026-10-22T13:00:00Z"), new Date("2026-10-22T14:00:00Z"), new Date("2026-10-23T14:00:00Z")];
    await store.update(r.id, { lastUsedAt: used });
    await store.update(r.id, { revokedAt: revoked, supersededAt: ends });
    expect(await store.get(r.id)).toMatchObject({ lastUsedAt: used, revokedAt: revoked, supersededAt: ends });
  });

  it(`${name}: refuses two records with the same public id`, async () => {
    const store = await make();
    const o = await owner(5);
    const id = pid();
    await store.insert(record(o, id));
    await expect(store.insert(record(o, id))).rejects.toThrow();
  });
}
