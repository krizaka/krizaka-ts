import { describe, expect, it } from "vitest";

import { bucketStore } from "../src/bucket-store";
import { memoryObjectStore } from "../src/memory-store";

const clock = { now: () => new Date("2026-11-17T10:00:00Z") };
const store = (extra: { serverSideEncryption?: boolean; prefix?: string } = {}) =>
  bucketStore({
    endpoint: "http://localhost:9000",
    region: "us-east-1",
    bucket: "kz",
    accessKeyId: "AK",
    secretAccessKey: "SK",
    fetch: async () => {
      throw new Error("no network in a unit test");
    },
    clock,
    ...extra,
  });
const policyOf = (fields: Record<string, string>) =>
  JSON.parse(Buffer.from(fields.policy!, "base64").toString("utf8")) as { expiration: string; conditions: unknown[] };

describe("presignUpload", () => {
  it("bounds the size, the key, the type and the lifetime in a signed policy", async () => {
    const up = await store().presignUpload("docs/a.pdf", 1000, ["application/pdf"], 600);
    expect(up!.url).toBe("http://localhost:9000/kz");
    expect(up!.maxBytes).toBe(1000);
    expect(up!.fields).toMatchObject({
      key: "docs/a.pdf",
      "Content-Type": "application/pdf",
      "x-amz-algorithm": "AWS4-HMAC-SHA256",
    });
    expect(up!.fields["x-amz-signature"]).toMatch(/^[0-9a-f]{64}$/);
    const policy = policyOf(up!.fields);
    expect(policy.expiration).toBe("2026-11-17T10:10:00.000Z");
    expect(policy.conditions).toContainEqual(["content-length-range", 1, 1000]);
    expect(policy.conditions).toContainEqual({ key: "docs/a.pdf" });
    expect(policy.conditions).toContainEqual({ bucket: "kz" });
    expect(policy.conditions).toContainEqual({ "Content-Type": "application/pdf" });
  });

  it("is deterministic and the signature depends on the bound", async () => {
    const a = await store().presignUpload("docs/a.pdf", 1000, ["application/pdf"], 600);
    const b = await store().presignUpload("docs/a.pdf", 1000, ["application/pdf"], 600);
    const c = await store().presignUpload("docs/a.pdf", 2000, ["application/pdf"], 600);
    expect(a!.fields["x-amz-signature"]).toBe(b!.fields["x-amz-signature"]);
    expect(a!.fields["x-amz-signature"]).not.toBe(c!.fields["x-amz-signature"]);
  });

  it("puts the key under the store's prefix and pins the encryption", async () => {
    const up = await store({ prefix: "t1", serverSideEncryption: true }).presignUpload("a.png", 5, ["image/png"], 60);
    expect(up!.fields.key).toBe("t1/a.png");
    expect(up!.fields["x-amz-server-side-encryption"]).toBe("AES256");
    expect(policyOf(up!.fields).conditions).toContainEqual({ "x-amz-server-side-encryption": "AES256" });
  });

  it("takes several types of one family, refuses a mixed list", async () => {
    const up = await store().presignUpload("a.png", 5, ["image/png", "image/jpeg"], 60);
    expect(up!.fields["Content-Type"]).toBeUndefined();
    expect(policyOf(up!.fields).conditions).toContainEqual(["starts-with", "$Content-Type", "image/"]);
    await expect(store().presignUpload("a.png", 5, ["image/png", "application/pdf"], 60)).rejects.toMatchObject({
      code: "STORAGE_BAD_TYPE",
    });
    await expect(store().presignUpload("a.png", 5, [], 60)).rejects.toMatchObject({ code: "STORAGE_BAD_TYPE" });
    await expect(store().presignUpload("a.png", 5, ["*/*"], 60)).rejects.toMatchObject({ code: "STORAGE_BAD_TYPE" });
  });

  it("refuses an unbounded size, a bad ttl and a bad key", async () => {
    await expect(store().presignUpload("a.png", 0, ["image/png"], 60)).rejects.toMatchObject({
      code: "STORAGE_TOO_BIG",
    });
    await expect(store().presignUpload("a.png", Infinity, ["image/png"], 60)).rejects.toMatchObject({
      code: "STORAGE_TOO_BIG",
    });
    await expect(store().presignUpload("a.png", 5, ["image/png"], 0)).rejects.toMatchObject({
      code: "STORAGE_BAD_CONFIG",
    });
    await expect(store().presignUpload("../a.png", 5, ["image/png"], 60)).rejects.toMatchObject({
      code: "STORAGE_BAD_KEY",
    });
  });

  it("is null where the provider cannot bound the size", async () => {
    expect(await memoryObjectStore().presignUpload("a/b.png", 5, ["image/png"], 60)).toBeNull();
  });
});
