import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bucketStore, memoryTenantKeyStore, type ObjectStore, openProvider, testConnection } from "../src/node";
import { type CatalogObject, moveBatch, type ObjectCatalog, readDual, sha256Hex } from "../src/provider-admin";
import { EMPTY_SHA256, signRequest } from "../src/request-signing";
import { objectStoreContract } from "../src/testkit";

/**
 * The managed provider against a real S3-compatible server in a container (CI sets STORAGE_S3_IT=1; locally with Docker running).
 * SeaweedFS (Apache-2.0) stands in for any S3 provider: MinIO's public images left Docker Hub and Quay.
 */
describe.runIf(process.env.STORAGE_S3_IT === "1")("the managed provider on an S3-compatible server (SeaweedFS)", () => {
  let server: StartedTestContainer;
  let endpoint = "";
  const keys = { accessKeyId: "s3-ci", secretAccessKey: "s3-ci-only-demo" };
  const root = Buffer.alloc(32, 7).toString("base64"); // a fixed local root key: test data only
  const clock = { now: () => new Date() };
  let n = 0;

  beforeAll(async () => {
    const identities = {
      identities: [
        {
          name: "ci",
          credentials: [{ accessKey: keys.accessKeyId, secretKey: keys.secretAccessKey }],
          actions: ["Admin", "Read", "Write", "List", "Tagging"],
        },
      ],
    };
    server = await new GenericContainer("chrislusf/seaweedfs:3.97")
      .withCopyContentToContainer([{ content: JSON.stringify(identities), target: "/etc/s3.json" }])
      .withCommand(["server", "-dir=/data", "-s3", "-s3.port=8333", "-s3.config=/etc/s3.json"])
      .withExposedPorts(8333)
      .withWaitStrategy(Wait.forLogMessage(/Start Seaweed S3 API Server/))
      .start();
    endpoint = `http://${server.getHost()}:${server.getMappedPort(8333)}`;
  }, 180_000);
  afterAll(async () => {
    await server?.stop();
  });

  const newBucket = async () => {
    n += 1;
    const name = `kz-managed-${n}`;
    const url = `${endpoint}/${name}`;
    const headers = signRequest(
      { ...keys, region: "us-east-1", service: "s3" },
      { method: "PUT", url, payloadHash: EMPTY_SHA256, now: new Date() },
    );
    expect((await fetch(url, { method: "PUT", headers })).status).toBe(200);
    return name;
  };
  const raw = (bucket: string): ObjectStore =>
    bucketStore({ endpoint, region: "us-east-1", bucket, ...keys, fetch, clock });
  const managed = async (bucket: string, tenantKeys = memoryTenantKeyStore()) =>
    openProvider(
      "managed",
      { endpoint, region: "us-east-1", bucket, kms: "local" },
      { ...keys, localRootKey: root },
      { runtime: "dev", environment: "dev", fetch, clock, managed: { keys: tenantKeys, audit: async () => {} } },
    );

  objectStoreContract("managed tenant store (SeaweedFS)", async () =>
    (await managed(await newBucket())).forTenant!("t-1"),
  );

  it("passes the admin's « test the connection » and leaves nothing behind", async () => {
    const bucket = await newBucket();
    const opened = await managed(bucket);
    const result = await testConnection(opened.store, "p1", () => Date.now());
    expect(result.ok).toBe(true);
    expect(await raw(bucket).list("")).toEqual([]);
  });

  it("the bucket holds ciphertext only; tenant B's store never reaches tenant A's object", async () => {
    const bucket = await newBucket();
    const opened = await managed(bucket);
    await opened.forTenant!("a").put("lease.pdf", new TextEncoder().encode("Bail de Marie"), {
      contentType: "application/pdf",
    });
    const stored = await raw(bucket).get("t/a/lease.pdf");
    expect(Buffer.from(stored!.bytes).toString("latin1")).not.toContain("Marie");
    expect(await opened.forTenant!("b").get("lease.pdf")).toBeNull();
    expect(await opened.forTenant!("b").list("")).toEqual([]);
  });

  /** The product's objects table, in memory: the row says where each object lives. */
  const catalogOf = (objects: (CatalogObject & { provider: string })[]): ObjectCatalog => ({
    pending: async (providerId, limit) => objects.filter((o) => o.provider === providerId).slice(0, limit),
    remaining: async (providerId) => objects.filter((o) => o.provider === providerId).length,
    async switchProvider(id, from, to) {
      const row = objects.find((o) => o.id === id && o.provider === from);
      if (!row) return false;
      row.provider = to;
      return true;
    },
  });

  it("switches a tenant between providers without losing a byte: own bucket → managed → another managed provider", async () => {
    const own = raw(await newBucket());
    const tenantKeys = memoryTenantKeyStore();
    const first = (await managed(await newBucket(), tenantKeys)).forTenant!("shop-1");
    const secondBucket = await newBucket();
    const second = (await managed(secondBucket, tenantKeys)).forTenant!("shop-1");
    const objects = Array.from({ length: 7 }, (_, i) => {
      const bytes = new TextEncoder().encode(`invoice ${i} `.repeat(50 + i));
      return {
        id: `o${i}`,
        key: `docs/invoice-${i}.pdf`,
        contentType: "application/pdf",
        sha256: sha256Hex(bytes),
        bytes,
      };
    });
    for (const o of objects) await own.put(o.key, o.bytes, { contentType: o.contentType });
    const rows = objects.map(({ bytes: _b, ...o }) => ({ ...o, provider: "own" }));
    const catalog = catalogOf(rows);
    const stores: Record<string, ObjectStore> = { own, first, second };
    const open = async (id: string) => stores[id]!;

    // A bounded batch, then the dual read serves every object wherever it is while the move runs.
    const batch = await moveBatch({
      catalog,
      from: { id: "own", store: own },
      to: { id: "first", store: first },
      limit: 3,
    });
    expect(batch).toMatchObject({ copied: 3, verified: 3, switched: 3, failed: [], left: 4 });
    for (const row of rows) {
      const found = await readDual({ key: row.key, providerId: row.provider, fallbackIds: ["own"], open });
      expect(sha256Hex(found!.bytes)).toBe(row.sha256);
    }
    expect(
      await moveBatch({ catalog, from: { id: "own", store: own }, to: { id: "first", store: first }, limit: 10 }),
    ).toMatchObject({ switched: 4, left: 0 });
    expect(
      await moveBatch({ catalog, from: { id: "first", store: first }, to: { id: "second", store: second }, limit: 10 }),
    ).toMatchObject({ copied: 7, verified: 7, switched: 7, failed: [], left: 0 });
    for (const o of objects) expect(sha256Hex((await second.get(o.key))!.bytes)).toBe(o.sha256);
    expect((await raw(secondBucket).list("t/shop-1/")).length).toBe(7);
  });

  it("a corrupted copy at the old provider is never switched", async () => {
    const own = raw(await newBucket());
    const target = (await managed(await newBucket())).forTenant!("t");
    await own.put("docs/a.pdf", new TextEncoder().encode("changed after upload"), { contentType: "application/pdf" });
    const rows = [
      {
        id: "a",
        key: "docs/a.pdf",
        contentType: "application/pdf",
        sha256: sha256Hex(new Uint8Array([1])),
        provider: "own",
      },
    ];
    const result = await moveBatch({
      catalog: catalogOf(rows),
      from: { id: "own", store: own },
      to: { id: "m", store: target },
      limit: 5,
    });
    expect(result.switched).toBe(0);
    expect(result.failed).toHaveLength(1);
    expect(rows[0]!.provider).toBe("own");
  });
});
