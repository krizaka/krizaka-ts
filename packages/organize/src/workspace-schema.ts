/**
 * The workspace layer's tables (ADR-003 §1), generated from the product's declaration, in their own Postgres schema (`organize` by
 * default, ADR-001 §3). Per kind, real foreign keys: a tag join and a status table that reference the product's entity table.
 * The product commits the SQL in its own sequence, with a drift test; later versions only add.
 */
import { MARKERS } from "./config";
import { ident } from "./sql";
import { TAG_ORIGIN } from "./workspace-port";

export interface WorkspaceKindDecl {
  /** The product's table of this kind (its `id` is a uuid). */
  table: string;
  /** The column that holds the entity's scope. Default `scope_id`. */
  scopeColumn?: string;
  /** How to tell that an entity is the scope's when the table has no scope column: a SQL condition on `e`, the scope as `$1`. */
  inScope?: string;
  /** The column the `from`/`to` filters read (a date or a timestamp). */
  dateColumn?: string;
  /** The columns the `q` filter searches. */
  textColumns?: readonly string[];
  /** The column the `collection` filter reads. */
  collectionColumn?: string;
  /** A derived set: the SQL expression of an entity's state on `e`, so the `status` filter can read it. */
  stateSql?: string;
}

export interface WorkspaceDecl {
  /** The table of the workspace, the scope (Yomizaka's accounts, Akinaza's shops). */
  scope: string;
  /** The table of the people who author views and move states (the accounts). */
  users: string;
  /** The Postgres schema of the layer. Default `organize`. */
  schema?: string;
  /** The kinds, by key (a SQL identifier: it names the kind's tables). */
  kinds: Record<string, WorkspaceKindDecl>;
}

export function resolveWorkspace(decl: WorkspaceDecl) {
  const schema = ident(decl.schema ?? "organize");
  const kinds = Object.fromEntries(
    Object.entries(decl.kinds).map(([kind, k]) => {
      const scopeColumn = ident(k.scopeColumn ?? "scope_id");
      return [
        ident(kind),
        {
          table: ident(k.table),
          inScope: k.inScope ?? `e.${scopeColumn} = $1`,
          dateColumn: k.dateColumn === undefined ? null : ident(k.dateColumn),
          textColumns: (k.textColumns ?? []).map(ident),
          collectionColumn: k.collectionColumn === undefined ? null : ident(k.collectionColumn),
          stateSql: k.stateSql ?? null,
          tagTable: `${schema}.${ident(`${kind}_tag`)}`,
          statusTable: `${schema}.${ident(`${kind}_status`)}`,
        },
      ] as const;
    }),
  );
  return { schema, scope: ident(decl.scope), users: ident(decl.users), config: `${schema}.kind_config`, tags: `${schema}.tag`, views: `${schema}.view`, kinds };
}
export type ResolvedWorkspace = ReturnType<typeof resolveWorkspace>;

const list = (values: readonly string[]) => values.map((v) => `'${v}'`).join(", ");

/**
 * The SQL of the workspace layer for a product's declaration.
 * @throws Error for a name that is not a safe SQL identifier
 */
export function workspaceMigration(decl: WorkspaceDecl): string {
  const r = resolveWorkspace(decl);
  const parts = [
    `
CREATE SCHEMA IF NOT EXISTS ${r.schema};
CREATE TABLE ${r.config} (
  kind       text PRIMARY KEY CHECK (kind ~ '^[a-z][a-z0-9_]{0,39}$'),
  config     jsonb NOT NULL CHECK (jsonb_typeof(config) = 'object'),
  version    integer NOT NULL CHECK (version >= 1),
  updated_at timestamptz NOT NULL,
  updated_by uuid REFERENCES ${r.users}(id) ON DELETE SET NULL
);
CREATE TABLE ${r.tags} (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_id   uuid NOT NULL REFERENCES ${r.scope}(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  name       text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  marker     text NOT NULL CHECK (marker IN (${list(MARKERS)})),
  origin     text NOT NULL CHECK (origin IN (${list(Object.values(TAG_ORIGIN))})),
  created_at timestamptz NOT NULL,
  UNIQUE (id, kind)
);
CREATE UNIQUE INDEX tag_scope_kind_name ON ${r.tags} (scope_id, kind, lower(name));
CREATE TABLE ${r.views} (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_id   uuid NOT NULL REFERENCES ${r.scope}(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  author_id  uuid NOT NULL REFERENCES ${r.users}(id) ON DELETE CASCADE,
  name       text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  filters    jsonb NOT NULL CHECK (jsonb_typeof(filters) = 'object'),
  shared     boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX view_author_name ON ${r.views} (scope_id, kind, author_id, lower(name));
CREATE INDEX view_shared ON ${r.views} (scope_id, kind) WHERE shared;`,
  ];
  for (const [kind, k] of Object.entries(r.kinds)) {
    parts.push(`
CREATE TABLE ${k.tagTable} (
  entity_id uuid NOT NULL REFERENCES ${k.table}(id) ON DELETE CASCADE,
  tag_id    uuid NOT NULL,
  kind      text NOT NULL DEFAULT '${kind}' CHECK (kind = '${kind}'),
  PRIMARY KEY (entity_id, tag_id),
  FOREIGN KEY (tag_id, kind) REFERENCES ${r.tags} (id, kind) ON DELETE CASCADE
);
CREATE INDEX ${kind}_tag_tag ON ${k.tagTable} (tag_id);
CREATE TABLE ${k.statusTable} (
  entity_id  uuid PRIMARY KEY REFERENCES ${k.table}(id) ON DELETE CASCADE,
  state      text NOT NULL CHECK (state ~ '^[a-z][a-z0-9_]{0,39}$'),
  changed_at timestamptz NOT NULL,
  changed_by uuid REFERENCES ${r.users}(id) ON DELETE SET NULL
);
CREATE INDEX ${kind}_status_state ON ${k.statusTable} (state);`);
  }
  return `${parts.join("\n")}\n`;
}
