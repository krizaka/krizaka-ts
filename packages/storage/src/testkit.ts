import { expect, it } from "vitest";

import type { ObjectStore } from "./port";

const bytes = (...n: number[]) => new Uint8Array(n);

/** What every `ObjectStore` adapter must do: the same behaviour behind the same port. `make` gives an empty store. */
export function objectStoreContract(name: string, make: () => ObjectStore | Promise<ObjectStore>) {
  it(`${name}: stores a file and reads it back byte for byte`, async () => {
    const store = await make();
    await store.put("site/home/a.b1.png", bytes(1, 2, 3, 255), { contentType: "image/png" });
    const got = await store.get("site/home/a.b1.png");
    expect([...got!.bytes]).toEqual([1, 2, 3, 255]);
    expect(got!.contentType).toBe("image/png");
    expect(await store.head("site/home/a.b1.png")).toEqual({ key: "site/home/a.b1.png", size: 4 });
  });

  it(`${name}: answers null for a missing file, and deleting it twice is fine`, async () => {
    const store = await make();
    expect(await store.get("missing/file.txt")).toBeNull();
    expect(await store.head("missing/file.txt")).toBeNull();
    await store.put("x/y.txt", bytes(1), { contentType: "text/plain" });
    await store.delete("x/y.txt");
    await store.delete("x/y.txt");
    expect(await store.get("x/y.txt")).toBeNull();
  });

  it(`${name}: overwrites a key`, async () => {
    const store = await make();
    await store.put("k/f.bin", bytes(1), { contentType: "application/octet-stream" });
    await store.put("k/f.bin", bytes(9, 9), { contentType: "application/octet-stream" });
    expect([...(await store.get("k/f.bin"))!.bytes]).toEqual([9, 9]);
  });

  it(`${name}: lists the files under a prefix, directories flattened, in key order`, async () => {
    const store = await make();
    for (const key of ["a/one.txt", "a/b/two.txt", "a/b/c/three.txt", "other/four.txt", "a-b/five.txt"]) await store.put(key, bytes(7), { contentType: "text/plain" });
    expect((await store.list("a/")).map((f) => f.key)).toEqual(["a/b/c/three.txt", "a/b/two.txt", "a/one.txt"]);
    expect((await store.list("a/b/")).map((f) => f.key)).toEqual(["a/b/c/three.txt", "a/b/two.txt"]);
    expect((await store.list("nothing/"))).toEqual([]);
    expect((await store.list("a/o")).map((f) => f.key)).toEqual(["a/one.txt"]);
  });

  it(`${name}: refuses a key that climbs out, is empty or has a bad segment`, async () => {
    const store = await make();
    for (const key of ["../x.txt", "a/../b.txt", "/abs.txt", "a//b.txt", "a/b/", "", "a\\b.txt"]) await expect(store.put(key, bytes(1), { contentType: "text/plain" })).rejects.toMatchObject({ code: "STORAGE_BAD_KEY" });
  });
}
