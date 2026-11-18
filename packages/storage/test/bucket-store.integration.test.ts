import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bucketStore } from "../src/bucket-store";
import { EMPTY_SHA256, signRequest } from "../src/request-signing";
import { objectStoreContract } from "../src/testkit";

/**
 * The S3 adapter against a real MinIO (CI sets STORAGE_S3_IT=1; locally with Docker running). Test credentials only.
 * MinIO's own images left Docker Hub and Quay: the image is a parameter (`STORAGE_MINIO_IMAGE`), a pinned community build by default.
 */
const IMAGE = process.env.STORAGE_MINIO_IMAGE ?? "insectai/minio:RELEASE.2026-09-16T00-00-00Z";

describe.runIf(process.env.STORAGE_S3_IT === "1")("the bucket store on MinIO", () => {
  let server: StartedTestContainer;
  let endpoint = "";
  const keys = { accessKeyId: "minio-ci", secretAccessKey: "minio-ci-only-demo" };
  const clock = { now: () => new Date() };
  let n = 0;

  beforeAll(async () => {
    server = await new GenericContainer(IMAGE)
      .withEnvironment({ MINIO_ROOT_USER: keys.accessKeyId, MINIO_ROOT_PASSWORD: keys.secretAccessKey })
      .withCommand(["server", "/data"])
      .withExposedPorts(9000)
      .withWaitStrategy(Wait.forHttp("/minio/health/ready", 9000))
      .start();
    endpoint = `http://${server.getHost()}:${server.getMappedPort(9000)}`;
  }, 300_000);
  afterAll(async () => {
    await server?.stop();
  });

  const newBucket = async () => {
    n += 1;
    const name = `kz-bucket-${n}`;
    const url = `${endpoint}/${name}`;
    const headers = signRequest(
      { ...keys, region: "us-east-1", service: "s3" },
      { method: "PUT", url, payloadHash: EMPTY_SHA256, now: new Date() },
    );
    expect((await fetch(url, { method: "PUT", headers })).status).toBe(200);
    return name;
  };
  const storeOn = (bucket: string) => bucketStore({ endpoint, region: "us-east-1", bucket, ...keys, fetch, clock });

  objectStoreContract("bucket store (MinIO)", async () => storeOn(await newBucket()));

  const post = (up: { url: string; fields: Record<string, string> }, body: Uint8Array, type: string) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(up.fields)) form.set(k, v);
    form.set("Content-Type", type); // the client names the type: the policy must refuse a different one
    form.set("file", new Blob([Buffer.from(body)], { type }), "f.bin");
    return fetch(up.url, { method: "POST", body: form });
  };

  it("accepts a presigned upload within maxBytes and stores it under the key", async () => {
    const store = storeOn(await newBucket());
    const up = (await store.presignUpload("in/a.bin", 100, ["application/octet-stream"], 300))!;
    const res = await post(up, new Uint8Array(100).fill(7), "application/octet-stream");
    expect(res.status).toBeLessThan(300);
    expect(await store.head("in/a.bin")).toEqual({ key: "in/a.bin", size: 100 });
  });

  it("refuses a presigned upload over maxBytes (nothing stored)", async () => {
    const store = storeOn(await newBucket());
    const up = (await store.presignUpload("in/big.bin", 100, ["application/octet-stream"], 300))!;
    const res = await post(up, new Uint8Array(101).fill(7), "application/octet-stream");
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("EntityTooLarge");
    expect(await store.head("in/big.bin")).toBeNull();
  });

  it("refuses another content type, another key and an expired link", async () => {
    const store = storeOn(await newBucket());
    const up = (await store.presignUpload("in/t.png", 100, ["image/png"], 300))!;
    expect((await post(up, new Uint8Array(5), "text/html")).status).toBe(403);
    const moved = { ...up, fields: { ...up.fields, key: "in/other.png" } };
    expect((await post(moved, new Uint8Array(5), "image/png")).status).toBe(403);
    const past = bucketStore({
      endpoint,
      region: "us-east-1",
      bucket: "kz-bucket-1",
      ...keys,
      fetch,
      clock: { now: () => new Date(Date.now() - 3_600_000) },
    });
    const old = (await past.presignUpload("in/old.png", 100, ["image/png"], 60))!;
    expect((await post(old, new Uint8Array(5), "image/png")).status).toBe(403);
  });
});
