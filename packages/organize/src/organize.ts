import { ORGANIZE_CODE, OrganizeError } from "./errors";
import { type Avatar, AVATAR_KIND, AvatarImageError, type AvatarProcessor, type AvatarRules, type ObjectStore, type Query } from "./port";
import { cleanDescription, cleanName, isId, isTagColor, type TagColor } from "./rules";
import { ident, type OrganizeSchema, resolved } from "./sql";

export interface Collection {
  id: string;
  name: string;
  description: string | null;
  avatar: Avatar | null;
  isDefault: boolean;
}
export interface Tag {
  id: string;
  name: string;
  color: TagColor;
}
export interface Profile {
  id: string;
  name: string;
  description: string | null;
  avatar: Avatar | null;
  collectionId: string | null;
}

export interface OrganizeDeps {
  query: Query;
  schema: OrganizeSchema;
  /** For uploaded avatars: the image maker and where the image is kept. Without them only avatars of the set are possible. */
  images?: { processor: AvatarProcessor; store: ObjectStore };
}

/** Where an uploaded avatar lives in the product's object store (a signed link to it is the product's to make). */
export const storedAvatarKey = (kind: string, owner: string, id: string, version: number) => `${kind}/${owner}/${id}/${version}`;

/** A unique violation becomes the stable 409. */
async function unique<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new OrganizeError(ORGANIZE_CODE.nameTaken);
    if (/DEFAULT_COLLECTION/.test((error as Error).message ?? "")) throw new OrganizeError(ORGANIZE_CODE.defaultCollection);
    throw error;
  }
}

const name = (raw: string) => {
  const clean = cleanName(raw);
  if (!clean) throw new OrganizeError(ORGANIZE_CODE.badRequest, "A name is 1 to 80 characters");
  return clean;
};

/**
 * « organize »: for every kind a product declares, a name, a description, an avatar, tags and a place in a collection; collections with
 * an undeletable default one; tags per owner. The invariants are the database's (see `organizeMigration`); this is the service over them.
 */
export function createOrganize(deps: OrganizeDeps) {
  const { query } = deps;
  const r = resolved(deps.schema);
  const COLLECTION = "collection";
  const tableOf = (kind: string) => (kind === COLLECTION ? { table: r.collections, ownerColumn: "owner_id" } : (r.kinds[kind] ?? (() => { throw new OrganizeError(ORGANIZE_CODE.badRequest, `unknown kind ${kind}`); })()));

  /** That the entity is the owner's (not found otherwise) — it needs no name or avatar column, so a kind that is only tagged can use it. */
  const owns = async (kind: string, owner: string, id: string): Promise<void> => {
    if (!isId(id)) throw new OrganizeError(ORGANIZE_CODE.notFound);
    const t = kind === COLLECTION ? { table: r.collections, owns: "e.owner_id = $1" } : (tableOf(kind) as { table: string; owns: string });
    const rows = await query(`SELECT 1 FROM ${t.table} e WHERE e.id = $2 AND ${t.owns}`, [owner, id]);
    if (rows.length === 0) throw new OrganizeError(ORGANIZE_CODE.notFound);
  };

  const owned = async (kind: string, owner: string, id: string): Promise<Profile> => {
    await owns(kind, owner, id);
    const t = tableOf(kind);
    const hasCollection = kind === COLLECTION ? false : (r.kinds[kind]?.inCollection ?? false);
    const [row] = await query<{ id: string; name: string; description: string | null; avatar: Avatar | null; collection_id?: string | null }>(
      `SELECT id, name, description, avatar${hasCollection ? ", collection_id" : ""} FROM ${t.table} WHERE id = $1`,
      [id],
    );
    if (!row) throw new OrganizeError(ORGANIZE_CODE.notFound);
    return { id: row.id, name: row.name, description: row.description, avatar: row.avatar, collectionId: row.collection_id ?? null };
  };

  const avatarKey = storedAvatarKey;
  const forget = (kind: string, owner: string, id: string, before: Avatar | null) => (deps.images && before?.kind === AVATAR_KIND.image ? deps.images.store.delete(avatarKey(kind, owner, id, before.version)).catch(() => undefined) : Promise.resolve());

  /** The avatar, the description and the name of any declared kind (and of a collection). */
  function profile(kind: string) {
    const t = tableOf(kind);
    return {
      get: (owner: string, id: string) => owned(kind, owner, id),
      async rename(owner: string, id: string, newName: string) {
        await owned(kind, owner, id);
        await unique(() => query(`UPDATE ${t.table} SET name = $2 WHERE id = $1`, [id, name(newName)]));
        return owned(kind, owner, id);
      },
      async describe(owner: string, id: string, text: string | null) {
        await owned(kind, owner, id);
        const clean = cleanDescription(text);
        if (!clean) throw new OrganizeError(ORGANIZE_CODE.badRequest, "A description is at most 500 characters");
        await query(`UPDATE ${t.table} SET description = $2 WHERE id = $1`, [id, clean.value]);
        return owned(kind, owner, id);
      },
      /** An avatar from the set the administrator allows, or none (`null`). A stored image it replaces is deleted. */
      async setAvatar(owner: string, id: string, seed: string | null, rules: Pick<AvatarRules, "allowedSeeds">) {
        const before = (await owned(kind, owner, id)).avatar;
        if (seed !== null && !rules.allowedSeeds.includes(seed)) throw new OrganizeError(ORGANIZE_CODE.avatarNotAllowed);
        await query(`UPDATE ${t.table} SET avatar = $2 WHERE id = $1`, [id, seed === null ? null : JSON.stringify({ kind: AVATAR_KIND.set, seed })]);
        await forget(kind, owner, id, before);
      },
      /** An uploaded image: processed (square, no metadata), kept under a new version, the old one deleted. */
      async uploadAvatar(owner: string, id: string, file: { name: string; type: string; bytes: Uint8Array }, rules: Pick<AvatarRules, "maxBytes">): Promise<Avatar> {
        const images = deps.images;
        if (!images) throw new OrganizeError(ORGANIZE_CODE.avatarStorageOff);
        const before = (await owned(kind, owner, id)).avatar;
        if (file.bytes.length > rules.maxBytes) throw new OrganizeError(ORGANIZE_CODE.avatarTooLarge);
        let made: { bytes: Uint8Array; contentType: string };
        try {
          made = await images.processor.process(file);
        } catch (error) {
          if (error instanceof AvatarImageError) throw Object.assign(new OrganizeError(ORGANIZE_CODE.avatarUnreadable, error.reason), { status: error.status });
          throw new OrganizeError(ORGANIZE_CODE.avatarUnreadable);
        }
        const version = (before?.kind === AVATAR_KIND.image ? before.version : 0) + 1;
        try {
          await images.store.put(avatarKey(kind, owner, id, version), made.bytes, { contentType: made.contentType });
        } catch {
          throw new OrganizeError(ORGANIZE_CODE.avatarStorageUnavailable);
        }
        const avatar: Avatar = { kind: AVATAR_KIND.image, version };
        await query(`UPDATE ${t.table} SET avatar = $2 WHERE id = $1`, [id, JSON.stringify(avatar)]);
        await forget(kind, owner, id, before);
        return avatar;
      },
      async readAvatar(owner: string, id: string) {
        const avatar = (await owned(kind, owner, id)).avatar;
        if (!deps.images || avatar?.kind !== AVATAR_KIND.image) return null;
        return deps.images.store.get(avatarKey(kind, owner, id, avatar.version));
      },
      async removeAvatar(owner: string, id: string) {
        const before = (await owned(kind, owner, id)).avatar;
        await query(`UPDATE ${t.table} SET avatar = NULL WHERE id = $1`, [id]);
        await forget(kind, owner, id, before);
      },
      /** The place of an entity: a collection of its owner, or none — which means the owner's default collection. */
      async setCollection(owner: string, id: string, collectionId: string | null) {
        if (kind === COLLECTION || !r.kinds[kind]?.inCollection) throw new OrganizeError(ORGANIZE_CODE.badRequest, "This kind is not in a collection");
        await owned(kind, owner, id);
        if (collectionId !== null) await owned(COLLECTION, owner, collectionId);
        await query(`UPDATE ${t.table} SET collection_id = $2 WHERE id = $1`, [id, collectionId ?? (await defaultId(owner))]);
      },
    };
  }

  async function defaultId(owner: string): Promise<string> {
    const [row] = await query<{ id: string }>(`SELECT id FROM ${r.collections} WHERE owner_id = $1 AND is_default`, [owner]);
    if (!row) throw new OrganizeError(ORGANIZE_CODE.noDefaultCollection);
    return row.id;
  }

  const collections = {
    ...profile(COLLECTION),
    defaultId,
    async list(owner: string): Promise<Collection[]> {
      const rows = await query<{ id: string; name: string; description: string | null; avatar: Avatar | null; is_default: boolean }>(`SELECT id, name, description, avatar, is_default FROM ${r.collections} WHERE owner_id = $1 ORDER BY is_default DESC, lower(name)`, [owner]);
      return rows.map((c) => ({ id: c.id, name: c.name, description: c.description, avatar: c.avatar, isDefault: c.is_default }));
    },
    /** `extra` carries the columns a product adds to its collections (a parent, a position…): identifiers are validated, values are parameters. */
    async create(owner: string, input: { name: string; description?: string | null; extra?: Record<string, unknown> }): Promise<Collection> {
      const description = cleanDescription(input.description);
      if (!description) throw new OrganizeError(ORGANIZE_CODE.badRequest, "A description is at most 500 characters");
      const extra = Object.entries(input.extra ?? {});
      const columns = ['owner_id', 'name', 'description', ...extra.map(([k]) => ident(k))];
      const [row] = await unique(() => query<{ id: string }>(`INSERT INTO ${r.collections} (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`, [owner, name(input.name), description.value, ...extra.map(([, v]) => v)]));
      const made = await collections.list(owner);
      return made.find((c) => c.id === row!.id)!;
    },
    /** Makes another collection the default: one statement, so there is always exactly one. */
    async setDefault(owner: string, id: string): Promise<void> {
      await owned(COLLECTION, owner, id);
      await query(`UPDATE ${r.collections} SET is_default = (id = $2) WHERE owner_id = $1 AND (is_default OR id = $2)`, [owner, id]);
    },
    /** Deletes a collection; what it holds goes to another collection of the owner, or to the default one. The default collection is never deleted. */
    async remove(owner: string, id: string, options: { moveTo?: string | null } = {}): Promise<void> {
      const target = await owned(COLLECTION, owner, id);
      const [flag] = await query<{ is_default: boolean }>(`SELECT is_default FROM ${r.collections} WHERE id = $1`, [id]);
      if (flag?.is_default) throw new OrganizeError(ORGANIZE_CODE.defaultCollection, "The default collection cannot be deleted: make another one the default first");
      if (options.moveTo === id) throw new OrganizeError(ORGANIZE_CODE.badRequest, "Choose another destination");
      const to = options.moveTo ? (await owned(COLLECTION, owner, options.moveTo)).id : await defaultId(owner);
      for (const k of Object.values(r.kinds).filter((x) => x.inCollection)) await query(`UPDATE ${k.table} SET collection_id = $2 WHERE collection_id = $1`, [id, to]);
      await forget(COLLECTION, owner, id, target.avatar);
      await unique(() => query(`DELETE FROM ${r.collections} WHERE id = $1`, [id]));
    },
  };

  const tags = {
    list: (owner: string) => query<Tag>(`SELECT id, name, color FROM ${r.tags} WHERE owner_id = $1 ORDER BY lower(name)`, [owner]),
    async create(owner: string, input: { name: string; color: TagColor }): Promise<Tag> {
      if (!isTagColor(input.color)) throw new OrganizeError(ORGANIZE_CODE.badRequest, "Unknown colour");
      const [row] = await unique(() => query<Tag>(`INSERT INTO ${r.tags} (owner_id, name, color) VALUES ($1, $2, $3) RETURNING id, name, color`, [owner, name(input.name), input.color]));
      return row!;
    },
    async update(owner: string, id: string, patch: { name?: string; color?: TagColor }): Promise<Tag> {
      if (!isId(id)) throw new OrganizeError(ORGANIZE_CODE.notFound);
      if (patch.color !== undefined && !isTagColor(patch.color)) throw new OrganizeError(ORGANIZE_CODE.badRequest, "Unknown colour");
      const [row] = await unique(() => query<Tag>(`UPDATE ${r.tags} SET name = COALESCE($3, name), color = COALESCE($4, color) WHERE owner_id = $1 AND id = $2 RETURNING id, name, color`, [owner, id, patch.name === undefined ? null : name(patch.name), patch.color ?? null]));
      if (!row) throw new OrganizeError(ORGANIZE_CODE.notFound);
      return row;
    },
    async remove(owner: string, id: string): Promise<void> {
      if (!isId(id)) throw new OrganizeError(ORGANIZE_CODE.notFound);
      const rows = await query(`DELETE FROM ${r.tags} WHERE owner_id = $1 AND id = $2 RETURNING id`, [owner, id]);
      if (rows.length === 0) throw new OrganizeError(ORGANIZE_CODE.notFound);
    },
    /** The tags of an entity (or a collection) become exactly these; only the owner's own tags count. */
    async assign(owner: string, kind: string, entityId: string, tagIds: readonly string[]): Promise<void> {
      await owns(kind, owner, entityId);
      const join = kind === COLLECTION ? { table: r.collectionTags, column: "collection_id" } : { table: r.kinds[kind]!.tagTable, column: r.kinds[kind]!.tagColumn };
      const ids = [...new Set(tagIds)];
      if (ids.some((t) => !isId(t))) throw new OrganizeError(ORGANIZE_CODE.badRequest, "Not a tag");
      if (ids.length) {
        const mine = await query<{ id: string }>(`SELECT id FROM ${r.tags} WHERE owner_id = $1 AND id = ANY($2::uuid[])`, [owner, ids]);
        if (mine.length !== ids.length) throw new OrganizeError(ORGANIZE_CODE.notFound, "Unknown tag");
      }
      await query(`DELETE FROM ${ident(join.table)} WHERE ${ident(join.column)} = $1`, [entityId]);
      if (ids.length) await query(`INSERT INTO ${ident(join.table)} (${ident(join.column)}, tag_id) SELECT $1, unnest($2::uuid[])`, [entityId, ids]);
    },
    /** The tags of several entities of a kind, by entity id. */
    async of(owner: string, kind: string, entityIds: readonly string[]): Promise<Map<string, Tag[]>> {
      const join = kind === COLLECTION ? { table: r.collectionTags, column: "collection_id" } : { table: r.kinds[kind]!.tagTable, column: r.kinds[kind]!.tagColumn };
      const out = new Map<string, Tag[]>();
      if (entityIds.length === 0) return out;
      const rows = await query<{ entity: string; id: string; name: string; color: TagColor }>(`SELECT j.${ident(join.column)} AS entity, t.id, t.name, t.color FROM ${ident(join.table)} j JOIN ${r.tags} t ON t.id = j.tag_id WHERE t.owner_id = $1 AND j.${ident(join.column)} = ANY($2::uuid[]) ORDER BY lower(t.name)`, [owner, [...entityIds]]);
      for (const row of rows) out.set(row.entity, [...(out.get(row.entity) ?? []), { id: row.id, name: row.name, color: row.color }]);
      return out;
    },
  };

  return { collections, tags, profile, kinds: Object.keys(r.kinds) };
}

export type Organize = ReturnType<typeof createOrganize>;
