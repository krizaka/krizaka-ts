import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AvatarImageError, type AvatarProcessor, createOrganize, type ObjectStore, organizeMigration, type OrganizeSchema, type Query } from "../src";

/** « organize » against a real PostgreSQL (CI's service; locally ORGANIZE_DB_IT=1 DATABASE_URL=…), in a schema of its own per run. */
const enabled = process.env.ORGANIZE_DB_IT === "1" && !!process.env.DATABASE_URL;

const SCHEMA: OrganizeSchema = { defaultName: { fr: "Mes boutiques", en: "My shops" }, kinds: { shop: { table: "shops" }, note: { table: "notes", inCollection: false } } };
const schemaName = `org_${Math.random().toString(36).slice(2, 10)}`;

class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  async put(key: string, bytes: Uint8Array, meta: { contentType: string }) {
    this.objects.set(key, { bytes, contentType: meta.contentType });
  }
  async get(key: string) {
    return this.objects.get(key) ?? null;
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
}
const processor: AvatarProcessor = {
  async process(file) {
    if (file.type !== "image/jpeg") throw new AvatarImageError(415, "UNSUPPORTED_TYPE");
    return { bytes: new Uint8Array([...file.bytes, 255]), contentType: "image/jpeg" };
  },
};
const RULES = { allowedSeeds: ["v1", "v2"], maxBytes: 1000 };

describe.runIf(enabled)("organize on PostgreSQL", () => {
  let client: pg.Client;
  let query: Query;
  const store = new MemoryStore();
  const organize = () => createOrganize({ query, schema: SCHEMA, images: { processor, store } });
  const owner = async (locale = "fr") => (await query<{ id: string }>("INSERT INTO accounts (email, locale) VALUES ($1, $2) RETURNING id", [`o-${Math.random().toString(36).slice(2)}@test`, locale]))[0]!.id;
  const shop = async (ownerId: string, name = `S${Math.random().toString(36).slice(2, 6)}`) => (await query<{ id: string }>("INSERT INTO shops (owner_id, name) VALUES ($1, $2) RETURNING id", [ownerId, name]))[0]!.id;
  const jpeg = (n = 10) => ({ name: "a.jpg", type: "image/jpeg", bytes: new Uint8Array(n) });
  const keysOf = (id: string) => [...store.objects.keys()].filter((k) => k.includes(id));

  beforeAll(async () => {
    client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query(`CREATE SCHEMA ${schemaName}; SET search_path TO ${schemaName}`);
    query = async (sql, params) => (await client.query(sql, params as unknown[])).rows as never;
    await client.query("CREATE TABLE accounts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE NOT NULL, locale text NOT NULL DEFAULT 'en')");
    await client.query("CREATE TABLE shops (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, name text NOT NULL)");
    await client.query("CREATE TABLE notes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, name text NOT NULL)");
    // a shop that exists before the migration: it must end up in its owner's default collection
    const early = (await query<{ id: string }>("INSERT INTO accounts (email, locale) VALUES ('early@test', 'fr') RETURNING id"))[0]!.id;
    await query("INSERT INTO shops (owner_id, name) VALUES ($1, 'Avant')", [early]);
    await client.query(organizeMigration(SCHEMA));
  });
  afterAll(async () => {
    await client.query(`DROP SCHEMA ${schemaName} CASCADE`);
    await client.end();
  });

  it("gives an existing owner a default collection and puts its entities in it (the backfill)", async () => {
    const [early] = await query<{ id: string }>("SELECT id FROM accounts WHERE email = 'early@test'");
    const list = await organize().collections.list(early!.id);
    expect(list).toEqual([expect.objectContaining({ name: "Mes boutiques", isDefault: true })]);
    const [row] = await query<{ collection_id: string }>("SELECT collection_id FROM shops WHERE owner_id = $1", [early!.id]);
    expect(row?.collection_id).toBe(list[0]!.id);
  });

  it("is created with the owner, in its language, and takes every entity given no place", async () => {
    const en = await owner("en");
    expect((await organize().collections.list(en)).map((c) => c.name)).toEqual(["My shops"]);
    const s = await shop(en);
    const [row] = await query<{ collection_id: string }>("SELECT collection_id FROM shops WHERE id = $1", [s]);
    expect(row?.collection_id).toBe(await organize().collections.defaultId(en));
  });

  it("is never deleted, there is exactly one, and the owner may choose another — never none", async () => {
    const o = await owner();
    const org = organize();
    const home = await org.collections.defaultId(o);
    await expect(org.collections.remove(o, home)).rejects.toMatchObject({ code: "DEFAULT_COLLECTION", status: 409 });
    await expect(query("DELETE FROM collections WHERE id = $1", [home])).rejects.toThrow(/DEFAULT_COLLECTION/);
    const other = await org.collections.create(o, { name: "Quartier Est" });
    await expect(query("UPDATE collections SET is_default = true WHERE id = $1", [other.id])).rejects.toThrow();
    await org.collections.setDefault(o, other.id);
    expect((await org.collections.list(o)).filter((c) => c.isDefault).map((c) => c.id)).toEqual([other.id]);
    await expect(query("UPDATE collections SET is_default = false WHERE id = $1", [other.id])).rejects.toThrow(/DEFAULT_COLLECTION/);
    await expect(org.collections.setDefault(o, "00000000-0000-4000-8000-000000000000")).rejects.toMatchObject({ code: "NOT_FOUND" });
    // the old default is an ordinary collection now
    const s = await shop(o);
    await org.profile("shop").setCollection(o, s, home);
    await org.collections.remove(o, home);
    const [row] = await query<{ collection_id: string }>("SELECT collection_id FROM shops WHERE id = $1", [s]);
    expect(row?.collection_id).toBe(other.id);
  });

  it("deleting an owner still deletes its default collection", async () => {
    const o = await owner();
    await query("DELETE FROM accounts WHERE id = $1", [o]);
    expect(await query("SELECT 1 FROM collections WHERE owner_id = $1", [o])).toEqual([]);
  });

  it("creates, renames, describes and lists collections; a name is unique per owner; entities move on delete", async () => {
    const o = await owner();
    const org = organize();
    const a = await org.collections.create(o, { name: "  Salons  ", description: "Les salons de coiffure." });
    expect(a).toMatchObject({ name: "Salons", description: "Les salons de coiffure.", isDefault: false });
    await expect(org.collections.create(o, { name: "Salons" })).rejects.toMatchObject({ code: "NAME_TAKEN" });
    await expect(org.collections.create(o, { name: "  " })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await org.collections.rename(o, a.id, "Studios")).name).toBe("Studios");
    expect((await org.collections.describe(o, a.id, null)).description).toBeNull();
    const b = await org.collections.create(o, { name: "Tatouage" });
    const s = await shop(o);
    await org.profile("shop").setCollection(o, s, a.id);
    await org.collections.remove(o, a.id, { moveTo: b.id });
    expect((await query<{ collection_id: string }>("SELECT collection_id FROM shops WHERE id = $1", [s]))[0]!.collection_id).toBe(b.id);
    await expect(org.collections.remove(o, b.id, { moveTo: b.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const stranger = await owner();
    await expect(org.collections.rename(stranger, b.id, "x")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("gives any declared kind a name, a description, an avatar and a collection", async () => {
    const o = await owner();
    const org = organize();
    const s = await shop(o);
    const shops = org.profile("shop");
    expect((await shops.rename(o, s, "Salon Cèdre")).name).toBe("Salon Cèdre");
    expect((await shops.describe(o, s, "Coupes et couleurs.")).description).toBe("Coupes et couleurs.");
    await expect(shops.describe(o, s, "x".repeat(501))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await shops.setAvatar(o, s, "v2", RULES);
    expect((await shops.get(o, s)).avatar).toEqual({ kind: "set", seed: "v2" });
    await expect(shops.setAvatar(o, s, "v9", RULES)).rejects.toMatchObject({ code: "AVATAR_NOT_ALLOWED" });
    await expect(org.profile("note").setCollection(o, s, null)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(shops.get(await owner(), s)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(() => org.profile("nope")).toThrow(/unknown kind/);
  });

  it("an uploaded avatar is processed, kept under a version of its own, replaced and removed with its object; refusals are stable", async () => {
    const o = await owner();
    const org = organize();
    const c = (await org.collections.create(o, { name: "Images" })).id;
    expect(await org.collections.uploadAvatar(o, c, jpeg(), RULES)).toEqual({ kind: "image", version: 1 });
    expect(keysOf(c)).toEqual([`collection/${o}/${c}/1`]);
    expect((await org.collections.readAvatar(o, c))?.contentType).toBe("image/jpeg");
    expect(await org.collections.uploadAvatar(o, c, jpeg(20), RULES)).toEqual({ kind: "image", version: 2 });
    expect(keysOf(c)).toEqual([`collection/${o}/${c}/2`]);
    await expect(org.collections.uploadAvatar(o, c, jpeg(5000), RULES)).rejects.toMatchObject({ code: "AVATAR_TOO_LARGE", status: 413 });
    await expect(org.collections.uploadAvatar(o, c, { ...jpeg(), type: "image/gif" }, RULES)).rejects.toMatchObject({ code: "AVATAR_UNREADABLE", status: 415 });
    await org.collections.setAvatar(o, c, "v1", RULES);
    expect(keysOf(c)).toEqual([]);
    await org.collections.uploadAvatar(o, c, jpeg(), RULES);
    await org.collections.removeAvatar(o, c);
    expect((await org.collections.get(o, c)).avatar).toBeNull();
    expect(keysOf(c)).toEqual([]);
    const noImages = createOrganize({ query, schema: SCHEMA });
    await expect(noImages.collections.uploadAvatar(o, c, jpeg(), RULES)).rejects.toMatchObject({ code: "AVATAR_STORAGE_OFF", status: 503 });
  });

  it("tags: per owner, named colours, unique by name, assigned to a kind or a collection, read back; a stranger's tag is refused", async () => {
    const o = await owner();
    const org = organize();
    const salon = await org.tags.create(o, { name: "Salon", color: "green" });
    await expect(org.tags.create(o, { name: "salon", color: "blue" })).rejects.toMatchObject({ code: "NAME_TAKEN" });
    await expect(org.tags.create(o, { name: "X", color: "#fff" as never })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const vip = await org.tags.create(o, { name: "VIP", color: "amber" });
    const s = await shop(o);
    await org.tags.assign(o, "shop", s, [salon.id, vip.id]);
    expect((await org.tags.of(o, "shop", [s])).get(s)?.map((t) => t.name)).toEqual(["Salon", "VIP"]);
    await org.tags.assign(o, "shop", s, [vip.id]);
    expect((await org.tags.of(o, "shop", [s])).get(s)?.map((t) => t.name)).toEqual(["VIP"]);
    const c = await org.collections.defaultId(o);
    await org.tags.assign(o, "collection", c, [salon.id]);
    expect((await org.tags.of(o, "collection", [c])).get(c)?.[0]?.color).toBe("green");
    expect(await org.tags.update(o, salon.id, { name: "Coiffure", color: "violet" })).toMatchObject({ name: "Coiffure", color: "violet" });
    const other = await owner();
    const theirs = await org.tags.create(other, { name: "Leur tag", color: "red" });
    await expect(org.tags.assign(o, "shop", s, [theirs.id])).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(org.tags.remove(o, theirs.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await org.tags.remove(o, vip.id);
    expect((await org.tags.of(o, "shop", [s])).get(s)).toBeUndefined();
    expect(await org.tags.of(o, "shop", [])).toEqual(new Map());
  });
});
