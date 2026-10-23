import type { FollowPage, FollowRecord, FollowStore, FollowTarget } from "./port";

const keyOf = (subjectId: string, target: FollowTarget) => JSON.stringify([subjectId, target.targetType, target.targetId]);
const copy = (record: FollowRecord): FollowRecord => ({ ...record, preferences: { ...record.preferences }, createdAt: new Date(record.createdAt) });
const byCreated = (a: FollowRecord, b: FollowRecord) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0) || a.subjectId.localeCompare(b.subjectId);

export function memoryFollowStore(): FollowStore {
  const rows = new Map<string, FollowRecord>();
  return {
    async get(subjectId, target) {
      const record = rows.get(keyOf(subjectId, target));
      return record ? copy(record) : null;
    },
    async insert(record) {
      const key = keyOf(record.subjectId, record);
      if (rows.has(key)) return;
      rows.set(key, copy(record));
    },
    async delete(subjectId, target) {
      rows.delete(keyOf(subjectId, target));
    },
    async update(subjectId, target, patch) {
      const record = rows.get(keyOf(subjectId, target));
      if (record) Object.assign(record, patch.preferences ? { preferences: { ...patch.preferences } } : {}, patch.muted === undefined ? {} : { muted: patch.muted });
    },
    async followers(target, page: Required<FollowPage>) {
      return [...rows.values()].filter((r) => r.targetType === target.targetType && r.targetId === target.targetId).sort(byCreated).slice(page.offset, page.offset + page.limit).map(copy);
    },
    async following(subjectId, page: Required<FollowPage>) {
      return [...rows.values()].filter((r) => r.subjectId === subjectId).sort((a, b) => byCreated(a, b) || a.targetType.localeCompare(b.targetType) || a.targetId.localeCompare(b.targetId)).slice(page.offset, page.offset + page.limit).map(copy);
    },
    async count(target) {
      return [...rows.values()].filter((r) => r.targetType === target.targetType && r.targetId === target.targetId).length;
    },
  };
}
