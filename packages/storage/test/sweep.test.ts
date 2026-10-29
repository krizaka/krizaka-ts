import { describe, expect, it } from "vitest";

import { memoryObjectStore, type ObjectStore, sweepOrphans } from "../src/index";

const bytes = new TextEncoder().encode("x");
const meta = { contentType: "text/plain" };

async function seeded(): Promise<ObjectStore> {
  const store = memoryObjectStore();
  for (const key of ["docs/o1/a/original.pdf", "docs/o1/b/original.pdf", "docs/o2/c/original.png", "other/z/file.txt"])
    await store.put(key, bytes, meta);
  return store;
}

describe("sweepOrphans", () => {
  it("deletes the files under the prefix that nothing references, and only those", async () => {
    const store = await seeded();
    const known = new Set(["docs/o1/a/original.pdf"]);
    const result = await sweepOrphans(store, "docs/", (key) => known.has(key));
    expect(result).toEqual({
      scanned: 3,
      orphans: ["docs/o1/b/original.pdf", "docs/o2/c/original.png"],
      deleted: 2,
      failed: [],
    });
    expect((await store.list("")).map((f) => f.key)).toEqual(["docs/o1/a/original.pdf", "other/z/file.txt"]);
  });

  it("deletes nothing on a dry run, and awaits an asynchronous lookup", async () => {
    const store = await seeded();
    const result = await sweepOrphans(store, "docs/", async () => false, { dryRun: true });
    expect(result.orphans).toHaveLength(3);
    expect(result.deleted).toBe(0);
    expect(await store.list("docs/")).toHaveLength(3);
  });

  it("is idempotent: a second run finds nothing", async () => {
    const store = await seeded();
    await sweepOrphans(store, "docs/", () => false);
    expect(await sweepOrphans(store, "docs/", () => false)).toEqual({
      scanned: 0,
      orphans: [],
      deleted: 0,
      failed: [],
    });
  });

  it("keeps going when one delete fails, and reports it for the next sweep", async () => {
    const inner = await seeded();
    const store: ObjectStore = {
      ...inner,
      async delete(key) {
        if (key.endsWith("b/original.pdf")) throw new Error("store down");
        await inner.delete(key);
      },
    };
    const result = await sweepOrphans(store, "docs/", () => false);
    expect(result.failed).toEqual(["docs/o1/b/original.pdf"]);
    expect(result.deleted).toBe(2);
    expect((await inner.list("docs/")).map((f) => f.key)).toEqual(["docs/o1/b/original.pdf"]);
  });

  it("bounds one run with a limit", async () => {
    const store = await seeded();
    const result = await sweepOrphans(store, "docs/", () => false, { limit: 1 });
    expect(result.deleted).toBe(1);
    expect(await store.list("docs/")).toHaveLength(2);
  });
});
