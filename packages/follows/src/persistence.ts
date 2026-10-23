import type { FollowPage, FollowRecord, FollowStore } from "./port";

export type Query = (sql: string, params?: unknown[]) => Promise<unknown[]>;

interface Row {
  subject_id: string;
  target_type: string;
  target_id: string;
  created_at: Date;
  preferences: FollowRecord["preferences"];
  muted: boolean;
}

const COLUMNS = "subject_id, target_type, target_id, created_at, preferences, muted";
const toRecord = (r: Row): FollowRecord => ({
  subjectId: r.subject_id,
  targetType: r.target_type,
  targetId: r.target_id,
  createdAt: r.created_at,
  preferences: r.preferences,
  muted: r.muted,
});

export function pgFollowStore(run: Query): FollowStore {
  const query = <T = unknown>(sql: string, params?: unknown[]) => run(sql, params) as Promise<T[]>;
  return {
    async get(subjectId, target) {
      const [row] = await query<Row>(`SELECT ${COLUMNS} FROM follows WHERE subject_id = $1 AND target_type = $2 AND target_id = $3`, [subjectId, target.targetType, target.targetId]);
      return row ? toRecord(row) : null;
    },
    async insert(r) {
      await query(`INSERT INTO follows (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (subject_id, target_type, target_id) DO NOTHING`, [r.subjectId, r.targetType, r.targetId, r.createdAt, r.preferences, r.muted]);
    },
    async delete(subjectId, target) {
      await query("DELETE FROM follows WHERE subject_id = $1 AND target_type = $2 AND target_id = $3", [subjectId, target.targetType, target.targetId]);
    },
    async update(subjectId, target, patch) {
      if (patch.preferences !== undefined) await query("UPDATE follows SET preferences = $4 WHERE subject_id = $1 AND target_type = $2 AND target_id = $3", [subjectId, target.targetType, target.targetId, patch.preferences]);
      if (patch.muted !== undefined) await query("UPDATE follows SET muted = $4 WHERE subject_id = $1 AND target_type = $2 AND target_id = $3", [subjectId, target.targetType, target.targetId, patch.muted]);
    },
    async followers(target, page: Required<FollowPage>) {
      return (await query<Row>(`SELECT ${COLUMNS} FROM follows WHERE target_type = $1 AND target_id = $2 ORDER BY created_at, subject_id LIMIT $3 OFFSET $4`, [target.targetType, target.targetId, page.limit, page.offset])).map(toRecord);
    },
    async following(subjectId, page: Required<FollowPage>) {
      return (await query<Row>(`SELECT ${COLUMNS} FROM follows WHERE subject_id = $1 ORDER BY created_at, target_type, target_id LIMIT $2 OFFSET $3`, [subjectId, page.limit, page.offset])).map(toRecord);
    },
    async count(target) {
      const [row] = await query<{ count: string | number }>("SELECT count(*) AS count FROM follows WHERE target_type = $1 AND target_id = $2", [target.targetType, target.targetId]);
      return Number(row?.count ?? 0);
    },
  };
}
