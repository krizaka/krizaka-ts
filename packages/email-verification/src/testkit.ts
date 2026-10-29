import { expect, it } from "vitest";

import type { CodeStore } from "./port";

const T0 = new Date("2026-10-29T12:00:00.000Z");
const challenge = (id: string, expiresAt = new Date(T0.valueOf() + 900_000)) => ({ id, proof: `p-${id}`, attempts: 0, expiresAt, payload: "{}" });

/** What every `CodeStore` adapter must do: the same behaviour behind the same port. `make` gives an empty store. */
export function codeStoreContract(name: string, make: () => CodeStore | Promise<CodeStore>) {
  it(`${name}: keeps and returns a challenge, null for an unknown id`, async () => {
    const store = await make();
    await store.put(challenge("a"));
    expect((await store.get("a"))?.proof).toBe("p-a");
    expect(await store.get("zzz")).toBeNull();
  });

  it(`${name}: counts failures one by one, null once the challenge is gone`, async () => {
    const store = await make();
    await store.put(challenge("a"));
    expect(await store.recordFailure("a")).toBe(1);
    expect(await store.recordFailure("a")).toBe(2);
    expect((await store.get("a"))?.attempts).toBe(2);
    expect(await store.recordFailure("nope")).toBeNull();
  });

  it(`${name}: a challenge is consumed once`, async () => {
    const store = await make();
    await store.put(challenge("a"));
    const results = await Promise.all([store.consume("a"), store.consume("a")]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await store.get("a")).toBeNull();
  });

  it(`${name}: purges the expired ones and only them`, async () => {
    const store = await make();
    await store.put(challenge("old", new Date(T0.valueOf() - 1000)));
    await store.put(challenge("live"));
    expect(await store.purge(T0)).toBe(1);
    expect(await store.get("old")).toBeNull();
    expect(await store.get("live")).not.toBeNull();
  });
}
