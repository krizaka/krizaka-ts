import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bucketStore } from "../src/bucket-store";
import { EMPTY_SHA256, signRequest } from "../src/request-signing";
import { objectStoreContract } from "../src/testkit";

/** The S3 adapter against a real S3 server, SeaweedFS (CI sets STORAGE_S3_IT=1; locally with Docker running). Test credentials only. */
const IMAGE = "chrislusf/seaweedfs:3.97@sha256:bb05d66d2963b1cc48073190781c3dd29e2c4c88a2ae2986bf58e38c86d89c6e";

describe.runIf(process.env.STORAGE_S3_IT === "1")("the bucket store on SeaweedFS", () => {
  let server: StartedTestContainer;
  let endpoint = "";
  const keys = { accessKeyId: "kz-ci", secretAccessKey: "kz-ci-only-demo" };
  const clock = { now: () => new Date() };
  let n = 0;

  beforeAll(async () => {
    server = await new GenericContainer(IMAGE)
      .withCopyContentToContainer([
        {
          content: JSON.stringify({
            identities: [
              {
                name: "ci",
                credentials: [{ accessKey: keys.accessKeyId, secretKey: keys.secretAccessKey }],
                actions: ["Admin", "Read", "Write", "List", "Tagging"],
              },
            ],
          }),
          target: "/etc/s3.json",
        },
      ])
      .withCommand(["server", "-dir=/data", "-s3", "-s3.port=8333", "-s3.config=/etc/s3.json"])
      .withExposedPorts(8333)
      .withWaitStrategy(Wait.forLogMessage(/Start Seaweed S3 API Server/))
      .start();
    endpoint = `http://${server.getHost()}:${server.getMappedPort(8333)}`;
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

  objectStoreContract("bucket store (SeaweedFS)", async () => storeOn(await newBucket()));

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
    const refused = async (res: Response) => {
      expect([400, 403]).toContain(res.status); // the servers differ on the code, not on the refusal
    };
    await refused(await post(up, new Uint8Array(5), "text/html"));
    const moved = { ...up, fields: { ...up.fields, key: "in/other.png" } };
    await refused(await post(moved, new Uint8Array(5), "image/png"));
    const past = bucketStore({
      endpoint,
      region: "us-east-1",
      bucket: "kz-bucket-1",
      ...keys,
      fetch,
      clock: { now: () => new Date(Date.now() - 3_600_000) },
    });
    const old = (await past.presignUpload("in/old.png", 100, ["image/png"], 60))!;
    await refused(await post(old, new Uint8Array(5), "image/png"));
  });
});
