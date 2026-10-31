import { describe, expect, it } from "vitest";

import { managedResidency, memoryTenantKeyStore, type OpenContext, openProvider, PROVIDER_KINDS } from "../src/node";
import { linkSeconds, providerAllowed, resolveManagedPolicy } from "../src/settings";

const clock = { now: () => new Date("2026-10-31T10:00:00Z") };
const noFetch = async () => {
  throw new Error("no network in this test");
};
const ctx = (over: Partial<OpenContext> = {}): OpenContext => ({
  runtime: "dev",
  environment: "dev",
  fetch: noFetch,
  clock,
  managed: { keys: memoryTenantKeyStore(), audit: async () => {} },
  ...over,
});
const coordinates = { endpoint: "https://s3.bhs.io.cloud.ovh.net", region: "bhs", bucket: "docs-dev", kms: "local" };
const credentials = { accessKeyId: "id", secretAccessKey: "secret" };

describe("the managed policy: tenant > plan > product > global", () => {
  it("is off and bring-your-own by default", () => {
    const p = resolveManagedPolicy({});
    expect(p).toMatchObject({ managed: false, allowed: "byo" });
    expect(providerAllowed(p, "managed")).toBe(false);
    expect(providerAllowed(p, "s3")).toBe(true);
  });

  it("takes each field from the most specific layer that sets it", () => {
    const p = resolveManagedPolicy({
      global: { quotaGigabytes: 1, maxLinkHours: 24 },
      product: { managed: true, allowed: "both", quotaGigabytes: 2 },
      plan: { quotaGigabytes: 50, maxLinkHours: undefined },
      tenant: { maxLinkHours: 2 },
    });
    expect(p).toMatchObject({ managed: true, allowed: "both", quotaGigabytes: 50, maxLinkHours: 2 });
    expect(providerAllowed(p, "managed")).toBe(true);
    expect(providerAllowed(p, "dropbox")).toBe(true);
  });

  it("managed only refuses bring-your-own — unless the service is off, so a tenant is never left with nothing", () => {
    expect(providerAllowed(resolveManagedPolicy({ product: { managed: true, allowed: "managed" } }), "s3")).toBe(false);
    expect(providerAllowed(resolveManagedPolicy({ product: { managed: false, allowed: "managed" } }), "s3")).toBe(true);
    expect(providerAllowed(resolveManagedPolicy({ tenant: { managed: true, allowed: "byo" } }), "managed")).toBe(false);
  });

  it("refuses a policy that contradicts itself, and a link longer than allowed", () => {
    expect(() => resolveManagedPolicy({ product: { retentionMinDays: 10, retentionMaxDays: 5 } })).toThrow(
      expect.objectContaining({ code: "STORAGE_BAD_CONFIG" }),
    );
    expect(() => resolveManagedPolicy({ tenant: { trashDays: 40, retentionMaxDays: 30 } })).toThrow(
      expect.objectContaining({ code: "STORAGE_BAD_CONFIG" }),
    );
    const p = resolveManagedPolicy({ plan: { maxLinkHours: 1 } });
    expect(linkSeconds(p, 3600)).toBe(3600);
    expect(() => linkSeconds(p, 3601)).toThrow(expect.objectContaining({ code: "STORAGE_BAD_CONFIG" }));
    expect(() => linkSeconds(p, 0)).toThrow(expect.objectContaining({ code: "STORAGE_BAD_CONFIG" }));
  });
});

describe("the managed provider kind", () => {
  it("is admin-only data, with no public or signed link, every key a sealed secret", () => {
    const kind = PROVIDER_KINDS.find((k) => k.kind === "managed")!;
    expect(kind).toMatchObject({ scopes: ["admin"], implemented: true });
    expect(kind.capabilities).toMatchObject({
      publicUrls: false,
      signedUrls: false,
      serverSideEncryption: "customer-key",
    });
    expect(kind.credentials.every((f) => f.type === "secret")).toBe(true);
    expect(kind.presets?.map((p) => p.id)).toEqual(
      expect.arrayContaining(["ovhcloud", "aws-s3", "google-cloud-storage", "digitalocean-spaces", "generic"]),
    );
  });

  it("opens one store per tenant and a probe store for the connection test", async () => {
    const opened = await openProvider("managed", coordinates, credentials, ctx());
    expect(opened.forTenant).toBeTypeOf("function");
    expect(opened.residency.text).toBe("Canada (Québec)");
    expect(await opened.store.signedUrl("a.txt", 60)).toBeNull();
  });

  it("says where the replica is when the admin declares it", () => {
    const r = managedResidency({
      ...coordinates,
      replicaEndpoint: "https://s3.ca-east-tor.io.cloud.ovh.net",
      replicaRegion: "ca-east-tor",
    });
    expect(r.text).toBe("Canada (Québec); replica: Canada (Ontario)");
    expect(r.replica?.province).toBe("ON");
  });

  it("refuses what would put data somewhere nobody expects", async () => {
    const refused = { code: "STORAGE_BAD_CONFIG" };
    await expect(
      openProvider("managed", coordinates, credentials, ctx({ environment: "prod", runtime: "server" })),
    ).rejects.toMatchObject(refused);
    await expect(
      openProvider("managed", coordinates, credentials, { ...ctx(), managed: undefined }),
    ).rejects.toMatchObject(refused);
    await expect(openProvider("managed", { ...coordinates, kms: "vault" }, credentials, ctx())).rejects.toMatchObject(
      refused,
    );
    await expect(openProvider("managed", { ...coordinates, kms: "okms" }, credentials, ctx())).rejects.toMatchObject(
      refused,
    );
    await expect(
      openProvider("managed", { ...coordinates, kms: "aws-kms" }, credentials, ctx({ runtime: "server" })),
    ).rejects.toMatchObject(refused);
    await expect(openProvider("managed", coordinates, credentials, ctx({ runtime: "device" }))).rejects.toMatchObject(
      refused,
    );
  });
});
