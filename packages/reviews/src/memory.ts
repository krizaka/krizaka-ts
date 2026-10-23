import { type Rating, REVIEW_STATE, type ReviewPage, type ReviewRecord, type ReviewState, type ReviewStore, type ReviewTarget } from "./port";

const copy = (r: ReviewRecord): ReviewRecord => ({
  ...r,
  createdAt: new Date(r.createdAt),
  updatedAt: new Date(r.updatedAt),
  ownerRepliedAt: r.ownerRepliedAt ? new Date(r.ownerRepliedAt) : null,
});
const byCreated = (a: ReviewRecord, b: ReviewRecord) => (a.createdAt > b.createdAt ? -1 : a.createdAt < b.createdAt ? 1 : 0) || a.id.localeCompare(b.id);
const matches = (record: ReviewRecord, target: ReviewTarget) => record.targetType === target.targetType && record.targetId === target.targetId;

export function memoryReviewStore(): ReviewStore {
  const rows = new Map<string, ReviewRecord>();
  const bySubjectTarget = (subjectId: string, target: ReviewTarget) => [...rows.values()].find((r) => r.subjectId === subjectId && matches(r, target));
  return {
    async upsert(record) {
      const old = bySubjectTarget(record.subjectId, record);
      const saved = old
        ? { ...record, id: old.id, createdAt: old.createdAt, ownerReply: old.ownerReply, ownerRepliedAt: old.ownerRepliedAt }
        : record;
      if (old) rows.delete(old.id);
      rows.set(saved.id, copy(saved));
      return copy(saved);
    },
    async get(id) {
      const record = rows.get(id);
      return record ? copy(record) : null;
    },
    async getBySubjectTarget(subjectId, target) {
      const record = bySubjectTarget(subjectId, target);
      return record ? copy(record) : null;
    },
    async list(target, page: Required<ReviewPage>, states) {
      return [...rows.values()].filter((r) => matches(r, target) && states.includes(r.state)).sort(byCreated).slice(page.offset, page.offset + page.limit).map(copy);
    },
    async setState(id, state: ReviewState, updatedAt) {
      const record = rows.get(id);
      if (record) Object.assign(record, { state, updatedAt: new Date(updatedAt) });
    },
    async setReply(id, reply, repliedAt) {
      const record = rows.get(id);
      if (record) Object.assign(record, { ownerReply: reply, ownerRepliedAt: new Date(repliedAt) });
    },
    async scoreDistribution(target) {
      const distribution: Record<Rating, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      for (const record of rows.values()) {
        if (matches(record, target) && record.state === REVIEW_STATE.published && record.verified) distribution[record.rating] += 1;
      }
      return distribution;
    },
  };
}
