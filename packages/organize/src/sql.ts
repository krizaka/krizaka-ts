/**
 * The migration of « organize », generated from the product's declaration. Invariants live in the database (ADR-006):
 * exactly one default collection per owner (an exclusion constraint checked at the end of the statement, plus a deferred constraint
 * trigger), never deleted while its owner exists, the owner's creation making it (in its language), and every entity that is given
 * no collection falling into it. Safe on a database that already has the owner table and the entity tables.
 */
const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;

/** A SQL identifier from the product's declaration: lower-case letters, digits, underscore. Never anything else reaches SQL. */
export function ident(name: string): string {
  if (!IDENT.test(name)) throw new Error(`not a safe SQL identifier: ${name}`);
  return name;
}

export interface KindDecl {
  /** The product's table of this kind (it has `id`, `name`, and its owner column). */
  table: string;
  /** The column that holds the owner's id. Default `owner_id`. */
  ownerColumn?: string;
  /** The tag join table (generated). Default `<table>_tags`. */
  tagTable?: string;
  /** The column of the join table that points at the entity. Default `entity_id`. */
  tagColumn?: string;
  /** `false` for a kind that is only tagged (it is not a member of a collection). Default `true`. */
  inCollection?: boolean;
  /** How to tell that an entity is the owner's when the table has no owner column: a SQL condition on the entity `e` with the owner as `$1`. Default `e.<ownerColumn> = $1`. */
  owns?: string;
}

export interface OrganizeSchema {
  /** The owner table (accounts, users…): its `id`, and the column that says the owner's language (`fr` or `en`). */
  owner?: { table?: string; localeColumn?: string };
  collections?: string;
  tags?: string;
  /** The collections' tag join table, when a product already has one under another name. Default `<collections>_tags`. */
  collectionTags?: string;
  /** What a new owner's default collection is called, by language. */
  defaultName?: { fr: string; en: string };
  kinds: Record<string, KindDecl>;
}

export const DEFAULTS = {
  ownerTable: "accounts",
  localeColumn: "locale",
  collections: "collections",
  tags: "tags",
} as const;

export function resolved(schema: OrganizeSchema) {
  const kinds = Object.fromEntries(
    Object.entries(schema.kinds).map(([kind, k]) => [
      kind,
      {
        table: ident(k.table),
        ownerColumn: ident(k.ownerColumn ?? "owner_id"),
        tagTable: ident(k.tagTable ?? `${k.table}_tags`),
        tagColumn: ident(k.tagColumn ?? "entity_id"),
        inCollection: k.inCollection ?? true,
        owns: k.owns ?? `e.${ident(k.ownerColumn ?? "owner_id")} = $1`,
      },
    ]),
  );
  return {
    ownerTable: ident(schema.owner?.table ?? DEFAULTS.ownerTable),
    localeColumn: ident(schema.owner?.localeColumn ?? DEFAULTS.localeColumn),
    collections: ident(schema.collections ?? DEFAULTS.collections),
    tags: ident(schema.tags ?? DEFAULTS.tags),
    collectionTags: ident(schema.collectionTags ?? `${schema.collections ?? DEFAULTS.collections}_tags`),
    defaultName: schema.defaultName ?? { fr: "Mes éléments", en: "My items" },
    kinds,
  };
}
export type Resolved = ReturnType<typeof resolved>;

const quote = (text: string) => `'${text.replace(/'/g, "''")}'`;

/**
 * The SQL of version 1 of « organize » for a product's declaration (collections, tags, the default-collection invariants).
 * @throws Error for a name that is not a safe SQL identifier
 */
export function organizeSql(schema: OrganizeSchema): string {
  const r = resolved(schema);
  const c = r.collections;
  const parts: string[] = [];
  parts.push(`
CREATE TABLE ${c} (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES ${r.ownerTable}(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  description text CHECK (description IS NULL OR length(description) <= 500),
  avatar      jsonb CHECK (avatar IS NULL OR (jsonb_typeof(avatar) = 'object' AND avatar->>'kind' IN ('set', 'image'))),
  is_default  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, name),
  CONSTRAINT ${c}_one_default EXCLUDE USING btree (owner_id WITH =) WHERE (is_default) DEFERRABLE INITIALLY IMMEDIATE
);
CREATE TABLE ${r.tags} (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES ${r.ownerTable}(id) ON DELETE CASCADE,
  name     text NOT NULL,
  color    text NOT NULL CHECK (color IN ('blue', 'green', 'amber', 'red', 'violet', 'gray'))
);
CREATE UNIQUE INDEX ${r.tags}_owner_name ON ${r.tags}(owner_id, lower(name));
CREATE TABLE ${r.collectionTags} (collection_id uuid NOT NULL REFERENCES ${c}(id) ON DELETE CASCADE, tag_id uuid NOT NULL REFERENCES ${r.tags}(id) ON DELETE CASCADE, PRIMARY KEY (collection_id, tag_id));
`);
  for (const k of Object.values(r.kinds)) {
    parts.push(`
ALTER TABLE ${k.table} ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE ${k.table} ADD COLUMN IF NOT EXISTS avatar jsonb;
${k.inCollection ? `ALTER TABLE ${k.table} ADD COLUMN IF NOT EXISTS collection_id uuid REFERENCES ${c}(id);\nCREATE INDEX IF NOT EXISTS ${k.table}_collection ON ${k.table}(collection_id);` : ""}
CREATE TABLE ${k.tagTable} (${k.tagColumn} uuid NOT NULL REFERENCES ${k.table}(id) ON DELETE CASCADE, tag_id uuid NOT NULL REFERENCES ${r.tags}(id) ON DELETE CASCADE, PRIMARY KEY (${k.tagColumn}, tag_id));
`);
  }
  parts.push(`
CREATE FUNCTION ${c}_create_default(p_owner uuid, p_locale text) RETURNS uuid AS $$
DECLARE col uuid; base text := CASE p_locale WHEN 'fr' THEN ${quote(r.defaultName.fr)} ELSE ${quote(r.defaultName.en)} END; candidate text := base; n int := 1;
BEGIN
  WHILE EXISTS (SELECT 1 FROM ${c} WHERE owner_id = p_owner AND name = candidate) LOOP n := n + 1; candidate := base || ' ' || n; END LOOP;
  INSERT INTO ${c} (owner_id, name, is_default) VALUES (p_owner, candidate, true) RETURNING id INTO col;
  RETURN col;
END $$ LANGUAGE plpgsql;

CREATE FUNCTION ${c}_owner_default() RETURNS trigger AS $$
BEGIN PERFORM ${c}_create_default(NEW.id, NEW.${r.localeColumn}); RETURN NEW; END $$ LANGUAGE plpgsql;
CREATE TRIGGER ${c}_owner_default AFTER INSERT ON ${r.ownerTable} FOR EACH ROW EXECUTE FUNCTION ${c}_owner_default();

CREATE FUNCTION ${c}_guard_default() RETURNS trigger AS $$
BEGIN
  IF OLD.is_default AND EXISTS (SELECT 1 FROM ${r.ownerTable} WHERE id = OLD.owner_id) THEN RAISE EXCEPTION 'DEFAULT_COLLECTION: the default collection cannot be deleted'; END IF;
  RETURN OLD;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER ${c}_guard_default BEFORE DELETE ON ${c} FOR EACH ROW EXECUTE FUNCTION ${c}_guard_default();

CREATE FUNCTION ${c}_exactly_one_default() RETURNS trigger AS $$
DECLARE o uuid := COALESCE(NEW.owner_id, OLD.owner_id);
BEGIN
  IF EXISTS (SELECT 1 FROM ${r.ownerTable} WHERE id = o) AND (SELECT count(*) FROM ${c} WHERE owner_id = o AND is_default) <> 1 THEN RAISE EXCEPTION 'DEFAULT_COLLECTION: an owner has exactly one default collection'; END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER ${c}_exactly_one_default AFTER INSERT OR UPDATE OR DELETE ON ${c} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${c}_exactly_one_default();
`);
  for (const k of Object.values(r.kinds).filter((x) => x.inCollection)) {
    parts.push(`
CREATE FUNCTION ${k.table}_default_collection() RETURNS trigger AS $$
BEGIN
  IF NEW.collection_id IS NULL THEN SELECT id INTO NEW.collection_id FROM ${c} WHERE owner_id = NEW.${k.ownerColumn} AND is_default; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER ${k.table}_default_collection BEFORE INSERT OR UPDATE OF collection_id ON ${k.table} FOR EACH ROW WHEN (NEW.collection_id IS NULL) EXECUTE FUNCTION ${k.table}_default_collection();
`);
  }
  // owners that exist already get their default collection, and their entities fall into it
  parts.push(
    `SELECT ${c}_create_default(o.id, o.${r.localeColumn}) FROM ${r.ownerTable} o WHERE NOT EXISTS (SELECT 1 FROM ${c} x WHERE x.owner_id = o.id AND x.is_default);`,
  );
  for (const k of Object.values(r.kinds).filter((x) => x.inCollection)) {
    parts.push(
      `UPDATE ${k.table} e SET collection_id = x.id FROM ${c} x WHERE e.collection_id IS NULL AND x.owner_id = e.${k.ownerColumn} AND x.is_default;`,
    );
  }
  return parts.join("\n");
}

/**
 * The same SQL, for a product that runs it by hand.
 * @deprecated Use `organizeSchema(declaration)` with `emitMigration` or `adoptMigration` from `@krizaka/db`: the SQL gets a version, a checksum and a marker. Removed in the next major.
 */
export const organizeMigration = organizeSql;
