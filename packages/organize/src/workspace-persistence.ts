/**
 * The workspace layer's store over PostgreSQL (the tables of `workspaceMigration`), through the product's `Query`: a pool, or the
 * client of an open transaction. And `filterSql`, the one WHERE fragment of every list a product shows.
 */
import type { KindConfig } from "./config";
import { ORGANIZE_CODE, OrganizeError } from "./errors";
import type { Query } from "./port";
import { STATUS_MODE, type StatusSet } from "./status-sets";
import type { ViewFilters } from "./views";
import type { SavedView, WorkspaceStore, WorkspaceTag } from "./workspace-port";
import { resolveWorkspace, type WorkspaceDecl } from "./workspace-schema";

/** A unique violation becomes the stable 409. */
async function unique<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new OrganizeError(ORGANIZE_CODE.nameTaken);
    throw error;
  }
}

interface ViewRow {
  id: string;
  kind: string;
  author_id: string;
  name: string;
  filters: ViewFilters;
  shared: boolean;
}
const toView = (r: ViewRow): SavedView => ({
  id: r.id,
  kind: r.kind,
  authorId: r.author_id,
  name: r.name,
  filters: r.filters,
  shared: r.shared,
});
const TAG = "id, kind, name, marker, origin";
const VIEW = "id, kind, author_id, name, filters, shared";

/**
 * The PostgreSQL store of the workspace layer.
 * @param query the product's SQL runner (pass the transaction's for `lock` to mean anything)
 * @param decl the product's declaration (the same as its migration's)
 * @returns a store that passes `workspaceStoreContract`
 */
export function dbWorkspaceStore(query: Query, decl: WorkspaceDecl): WorkspaceStore {
  const r = resolveWorkspace(decl);
  const kindOf = (kind: string) =>
    r.kinds[kind] ??
    (() => {
      throw new OrganizeError(ORGANIZE_CODE.badRequest, `unknown kind ${kind}`);
    })();
  const pairs = (list: readonly { entityId: string; tagId: string }[]) => [
    list.map((p) => p.entityId),
    list.map((p) => p.tagId),
  ];
  return {
    async config(kind) {
      const [row] = await query<{ config: KindConfig; version: number }>(
        `SELECT config, version FROM ${r.config} WHERE kind = $1`,
        [kind],
      );
      return row ? { config: row.config, version: row.version } : null;
    },
    async saveConfig(kind, config, expected, at, by) {
      const rows =
        expected === null
          ? await query<{ version: number }>(
              `INSERT INTO ${r.config} (kind, config, version, updated_at, updated_by) VALUES ($1, $2, 1, $3, $4) ON CONFLICT (kind) DO NOTHING RETURNING version`,
              [kind, JSON.stringify(config), at, by],
            )
          : await query<{ version: number }>(
              `UPDATE ${r.config} SET config = $2, version = version + 1, updated_at = $4, updated_by = $5 WHERE kind = $1 AND version = $3 RETURNING version`,
              [kind, JSON.stringify(config), expected, at, by],
            );
      return rows[0]?.version ?? null;
    },
    async inScope(scope, kind, ids, options = {}) {
      const k = kindOf(kind);
      if (ids.length === 0) return [];
      const rows = await query<{ id: string }>(
        `SELECT e.id FROM ${k.table} e WHERE (${k.inScope}) AND e.id = ANY($2::uuid[])${options.lock ? " FOR UPDATE OF e" : ""}`,
        [scope, [...ids]],
      );
      return rows.map((row) => row.id);
    },
    async lockScope(scope) {
      await query(`SELECT 1 FROM ${r.scope} WHERE id = $1 FOR UPDATE`, [scope]);
    },
    tags: (scope, kind) =>
      query<WorkspaceTag>(`SELECT ${TAG} FROM ${r.tags} WHERE scope_id = $1 AND kind = $2 ORDER BY lower(name)`, [
        scope,
        kind,
      ]),
    async addTag(scope, kind, tag, at) {
      const [row] = await unique(() =>
        query<WorkspaceTag>(
          `INSERT INTO ${r.tags} (scope_id, kind, name, marker, origin, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${TAG}`,
          [scope, kind, tag.name, tag.marker, tag.origin, at],
        ),
      );
      return row!;
    },
    async updateTag(scope, kind, id, patch) {
      const [row] = await unique(() =>
        query<WorkspaceTag>(
          `UPDATE ${r.tags} SET name = COALESCE($4, name), marker = COALESCE($5, marker) WHERE scope_id = $1 AND kind = $2 AND id = $3 RETURNING ${TAG}`,
          [scope, kind, id, patch.name ?? null, patch.marker ?? null],
        ),
      );
      return row ?? null;
    },
    async removeTag(scope, kind, id) {
      return (
        (
          await query(`DELETE FROM ${r.tags} WHERE scope_id = $1 AND kind = $2 AND id = $3 RETURNING id`, [
            scope,
            kind,
            id,
          ])
        ).length > 0
      );
    },
    async tagsOf(kind, entityIds) {
      const out = new Map<string, string[]>();
      if (entityIds.length === 0) return out;
      const rows = await query<{ entity_id: string; tag_id: string }>(
        `SELECT entity_id, tag_id FROM ${kindOf(kind).tagTable} WHERE entity_id = ANY($1::uuid[])`,
        [[...entityIds]],
      );
      for (const row of rows) out.set(row.entity_id, [...(out.get(row.entity_id) ?? []), row.tag_id]);
      return out;
    },
    async link(kind, list) {
      if (list.length)
        await query(
          `INSERT INTO ${kindOf(kind).tagTable} (entity_id, tag_id) SELECT * FROM unnest($1::uuid[], $2::uuid[]) ON CONFLICT DO NOTHING`,
          pairs(list),
        );
    },
    async unlink(kind, list) {
      if (list.length)
        await query(
          `DELETE FROM ${kindOf(kind).tagTable} t USING unnest($1::uuid[], $2::uuid[]) AS p(entity_id, tag_id) WHERE t.entity_id = p.entity_id AND t.tag_id = p.tag_id`,
          pairs(list),
        );
    },
    async states(kind, entityIds) {
      const rows = entityIds.length
        ? await query<{ entity_id: string; state: string; changed_at: Date }>(
            `SELECT entity_id, state, changed_at FROM ${kindOf(kind).statusTable} WHERE entity_id = ANY($1::uuid[])`,
            [[...entityIds]],
          )
        : [];
      return new Map(rows.map((row) => [row.entity_id, { state: row.state, changedAt: row.changed_at }]));
    },
    async setState(kind, entityId, state, at, by) {
      await query(
        `INSERT INTO ${kindOf(kind).statusTable} (entity_id, state, changed_at, changed_by) VALUES ($1, $2, $3, $4) ON CONFLICT (entity_id) DO UPDATE SET state = excluded.state, changed_at = excluded.changed_at, changed_by = excluded.changed_by`,
        [entityId, state, at, by],
      );
    },
    async statesInUse(kind, states) {
      if (states.length === 0) return [];
      return (
        await query<{ state: string }>(
          `SELECT DISTINCT state FROM ${kindOf(kind).statusTable} WHERE state = ANY($1::text[]) ORDER BY state`,
          [[...states]],
        )
      ).map((row) => row.state);
    },
    async views(scope, kind, userId) {
      return (
        await query<ViewRow>(
          `SELECT ${VIEW} FROM ${r.views} WHERE scope_id = $1 AND kind = $2 AND (shared OR author_id = $3) ORDER BY lower(name), id`,
          [scope, kind, userId],
        )
      ).map(toView);
    },
    async view(scope, id) {
      const [row] = await query<ViewRow>(`SELECT ${VIEW} FROM ${r.views} WHERE scope_id = $1 AND id = $2`, [scope, id]);
      return row ? toView(row) : null;
    },
    async addView(scope, view, at) {
      const [row] = await unique(() =>
        query<ViewRow>(
          `INSERT INTO ${r.views} (scope_id, kind, author_id, name, filters, shared, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${VIEW}`,
          [scope, view.kind, view.authorId, view.name, JSON.stringify(view.filters), view.shared, at],
        ),
      );
      return toView(row!);
    },
    async updateView(scope, id, patch) {
      const [row] = await unique(() =>
        query<ViewRow>(
          `UPDATE ${r.views} SET name = COALESCE($3, name), filters = COALESCE($4, filters), shared = COALESCE($5, shared) WHERE scope_id = $1 AND id = $2 RETURNING ${VIEW}`,
          [scope, id, patch.name ?? null, patch.filters ? JSON.stringify(patch.filters) : null, patch.shared ?? null],
        ),
      );
      return row ? toView(row) : null;
    },
    async removeView(scope, id) {
      return (
        (await query(`DELETE FROM ${r.views} WHERE scope_id = $1 AND id = $2 RETURNING id`, [scope, id])).length > 0
      );
    },
  };
}

/**
 * The WHERE fragment of a view's filters, for the product's own list query on its entity table aliased `e`: it starts with ` AND`
 * (empty when there is nothing), and numbers its parameters from `from`. A filter the kind does not declare (no date column, no
 * text columns, no collection column, a derived set without `stateSql`) is ignored.
 * @param decl the product's declaration
 * @param kind the kind listed
 * @param filters the view's filters (from `parseView` or a saved view)
 * @param options `from`: the number of the first parameter; `status`: the kind's set (its initial state counts for entities nobody moved)
 * @returns the SQL and its parameters, to append to the query's own
 */
export function filterSql(
  decl: WorkspaceDecl,
  kind: string,
  filters: ViewFilters,
  options: { from: number; status?: StatusSet | null },
): { sql: string; params: unknown[] } {
  const r = resolveWorkspace(decl);
  const k = r.kinds[kind];
  if (!k) throw new OrganizeError(ORGANIZE_CODE.badRequest, `unknown kind ${kind}`);
  const parts: string[] = [];
  const params: unknown[] = [];
  const add = (value: unknown) => `$${options.from + params.push(value) - 1}`;
  if (filters.tags?.length)
    parts.push(
      `NOT EXISTS (SELECT 1 FROM unnest(${add(filters.tags)}::uuid[]) want(id) WHERE NOT EXISTS (SELECT 1 FROM ${k.tagTable} t WHERE t.entity_id = e.id AND t.tag_id = want.id))`,
    );
  const set = options.status ?? null;
  if (filters.status?.length && set) {
    if (set.mode === STATUS_MODE.editable)
      parts.push(
        `COALESCE((SELECT s.state FROM ${k.statusTable} s WHERE s.entity_id = e.id), ${add(set.initial)}) = ANY(${add(filters.status)}::text[])`,
      );
    else if (k.stateSql) parts.push(`(${k.stateSql}) = ANY(${add(filters.status)}::text[])`);
  }
  if (filters.collection && k.collectionColumn)
    parts.push(`e.${k.collectionColumn} = ${add(filters.collection)}::uuid`);
  if (filters.from && k.dateColumn) parts.push(`e.${k.dateColumn} >= ${add(filters.from)}::date`);
  if (filters.to && k.dateColumn) parts.push(`e.${k.dateColumn} < ${add(filters.to)}::date + 1`);
  if (filters.q && k.textColumns.length) {
    const escaped = filters.q.replace(/[\\%_]/g, (c) => `\\${c}`);
    const like = add(`%${escaped}%`);
    const columns = k.textColumns.map((c) => `e.${c} ILIKE ${like}`);
    parts.push(`(${columns.join(" OR ")})`);
  }
  return { sql: parts.map((p) => ` AND ${p}`).join(""), params };
}
