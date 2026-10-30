/**
 * An in-memory store of the workspace layer, for unit tests and demos: the same behaviour as the database's (`workspaceStoreContract`).
 * The entities are the product's, so the store is told which exist and in which scope (`entities`).
 */
import crypto from "node:crypto";

import { ORGANIZE_CODE, OrganizeError } from "./errors";
import type { SavedView, StoredConfig, WorkspaceStore, WorkspaceTag } from "./workspace-port";

interface Kept<T> {
  scope: string;
  row: T;
}

/**
 * @param entities the product's entities: kind → entity id → its scope (mutable: a test adds to it)
 * @returns a store that passes `workspaceStoreContract`
 */
export function memoryWorkspaceStore(entities: Map<string, Map<string, string>> = new Map()): WorkspaceStore {
  const configs = new Map<string, StoredConfig>();
  const tags: Kept<WorkspaceTag>[] = [];
  const links = new Map<string, Set<string>>(); // `${kind}:${entity}` → tag ids
  const states = new Map<string, { state: string; changedAt: Date }>(); // `${kind}:${entity}`
  const views: Kept<SavedView>[] = [];
  const copy = <T>(value: T): T => structuredClone(value);
  const key = (kind: string, id: string) => `${kind}:${id}`;
  const taken = (exists: boolean) => {
    if (exists) throw new OrganizeError(ORGANIZE_CODE.nameTaken);
  };
  const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const tagOf = (scope: string, kind: string, id: string) =>
    tags.find((t) => t.scope === scope && t.row.kind === kind && t.row.id === id);
  const viewOf = (scope: string, id: string) => views.find((v) => v.scope === scope && v.row.id === id);
  const forgetTag = (id: string) => {
    for (const set of links.values()) set.delete(id);
  };
  return {
    async config(kind) {
      const found = configs.get(kind);
      return found ? copy(found) : null;
    },
    async saveConfig(kind, config, expected) {
      const found = configs.get(kind);
      if ((found?.version ?? null) !== expected) return null;
      const version = (found?.version ?? 0) + 1;
      configs.set(kind, { config: copy(config), version });
      return version;
    },
    async inScope(scope, kind, ids) {
      const mine = entities.get(kind) ?? new Map<string, string>();
      return [...new Set(ids)].filter((id) => mine.get(id) === scope);
    },
    async lockScope() {
      // One process, one event loop: nothing to lock.
    },
    async tags(scope, kind) {
      return tags
        .filter((t) => t.scope === scope && t.row.kind === kind)
        .map((t) => copy(t.row))
        .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    },
    async addTag(scope, kind, tag) {
      taken(tags.some((t) => t.scope === scope && t.row.kind === kind && sameName(t.row.name, tag.name)));
      const row: WorkspaceTag = { id: crypto.randomUUID(), kind, ...tag };
      tags.push({ scope, row });
      return copy(row);
    },
    async updateTag(scope, kind, id, patch) {
      const found = tagOf(scope, kind, id);
      if (!found) return null;
      if (patch.name !== undefined)
        taken(
          tags.some(
            (t) => t !== found && t.scope === scope && t.row.kind === kind && sameName(t.row.name, patch.name!),
          ),
        );
      Object.assign(
        found.row,
        patch.name === undefined ? {} : { name: patch.name },
        patch.marker === undefined ? {} : { marker: patch.marker },
      );
      return copy(found.row);
    },
    async removeTag(scope, kind, id) {
      const found = tagOf(scope, kind, id);
      if (!found) return false;
      tags.splice(tags.indexOf(found), 1);
      forgetTag(id);
      return true;
    },
    async tagsOf(kind, entityIds) {
      return new Map(
        entityIds.flatMap((id) =>
          links.get(key(kind, id))?.size ? [[id, [...links.get(key(kind, id))!]] as const] : [],
        ),
      );
    },
    async link(kind, pairs) {
      for (const p of pairs) {
        if (!tags.some((t) => t.row.id === p.tagId && t.row.kind === kind))
          throw new Error("foreign key: the tag is not of this kind");
        links.set(key(kind, p.entityId), (links.get(key(kind, p.entityId)) ?? new Set()).add(p.tagId));
      }
    },
    async unlink(kind, pairs) {
      for (const p of pairs) links.get(key(kind, p.entityId))?.delete(p.tagId);
    },
    async states(kind, entityIds) {
      return new Map(
        entityIds.flatMap((id) => (states.has(key(kind, id)) ? [[id, copy(states.get(key(kind, id))!)] as const] : [])),
      );
    },
    async setState(kind, entityId, state, at) {
      states.set(key(kind, entityId), { state, changedAt: at });
    },
    async statesInUse(kind, wanted) {
      const held = new Set([...states.entries()].filter(([k]) => k.startsWith(`${kind}:`)).map(([, v]) => v.state));
      return [...new Set(wanted)].filter((s) => held.has(s)).sort((a, b) => a.localeCompare(b));
    },
    async views(scope, kind, userId) {
      return views
        .filter((v) => v.scope === scope && v.row.kind === kind && (v.row.shared || v.row.authorId === userId))
        .map((v) => copy(v.row))
        .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.id.localeCompare(b.id));
    },
    async view(scope, id) {
      const found = viewOf(scope, id);
      return found ? copy(found.row) : null;
    },
    async addView(scope, view) {
      taken(
        views.some(
          (v) =>
            v.scope === scope &&
            v.row.kind === view.kind &&
            v.row.authorId === view.authorId &&
            sameName(v.row.name, view.name),
        ),
      );
      const row: SavedView = { id: crypto.randomUUID(), ...copy(view) };
      views.push({ scope, row });
      return copy(row);
    },
    async updateView(scope, id, patch) {
      const found = viewOf(scope, id);
      if (!found) return null;
      if (patch.name !== undefined)
        taken(
          views.some(
            (v) =>
              v !== found &&
              v.scope === scope &&
              v.row.kind === found.row.kind &&
              v.row.authorId === found.row.authorId &&
              sameName(v.row.name, patch.name!),
          ),
        );
      Object.assign(found.row, Object.fromEntries(Object.entries(copy(patch)).filter(([, v]) => v !== undefined)));
      return copy(found.row);
    },
    async removeView(scope, id) {
      const found = viewOf(scope, id);
      if (!found) return false;
      views.splice(views.indexOf(found), 1);
      return true;
    },
  };
}
