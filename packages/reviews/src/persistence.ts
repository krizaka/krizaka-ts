import type { Rating, ReviewPage, ReviewRecord, ReviewState, ReviewStore } from "./port";

export type Query = (sql: string, params?: unknown[]) => Promise<unknown[]>;

interface Row {
  id: string;
  subject_id: string;
  target_type: string;
  target_id: string;
  rating: number;
  text: string | null;
  verified: boolean;
  state: ReviewState;
  created_at: Date;
  updated_at: Date;
  owner_reply: string | null;
  owner_replied_at: Date | null;
}

const COLUMNS = "id, subject_id, target_type, target_id, rating, text, verified, state, created_at, updated_at, owner_reply, owner_replied_at";
const toRecord = (r: Row): ReviewRecord => ({
  id: r.id,
  subjectId: r.subject_id,
  targetType: r.target_type,
  targetId: r.target_id,
  rating: r.rating as Rating,
  text: r.text,
  verified: r.verified,
  state: r.state,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  ownerReply: r.owner_reply,
  ownerRepliedAt: r.owner_replied_at,
});

export function pgReviewStore(run: Query): ReviewStore {
  const query = <T = unknown>(sql: string, params?: unknown[]) => run(sql, params) as Promise<T[]>;
  return {
    async upsert(r) {
      const [row] = await query<Row>(
        `INSERT INTO reviews (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (subject_id, target_type, target_id) DO UPDATE SET rating = EXCLUDED.rating, text = EXCLUDED.text,
         verified = EXCLUDED.verified, updated_at = EXCLUDED.updated_at, state = EXCLUDED.state RETURNING ${COLUMNS}`,
        [r.id, r.subjectId, r.targetType, r.targetId, r.rating, r.text, r.verified, r.state, r.createdAt, r.updatedAt, r.ownerReply, r.ownerRepliedAt],
      );
      return toRecord(row!);
    },
    async get(id) {
      const [row] = await query<Row>(`SELECT ${COLUMNS} FROM reviews WHERE id = $1`, [id]);
      return row ? toRecord(row) : null;
    },
    async getBySubjectTarget(subjectId, target) {
      const [row] = await query<Row>(`SELECT ${COLUMNS} FROM reviews WHERE subject_id = $1 AND target_type = $2 AND target_id = $3`, [subjectId, target.targetType, target.targetId]);
      return row ? toRecord(row) : null;
    },
    async list(target, page: Required<ReviewPage>, states) {
      return (await query<Row>(`SELECT ${COLUMNS} FROM reviews WHERE target_type = $1 AND target_id = $2 AND state = ANY($3::text[]) ORDER BY created_at DESC, id LIMIT $4 OFFSET $5`, [target.targetType, target.targetId, states, page.limit, page.offset])).map(toRecord);
    },
    async setState(id, state: ReviewState, updatedAt) {
      await query("UPDATE reviews SET state = $2, updated_at = $3 WHERE id = $1", [id, state, updatedAt]);
    },
    async setReply(id, reply, repliedAt) {
      await query("UPDATE reviews SET owner_reply = $2, owner_replied_at = $3 WHERE id = $1", [id, reply, repliedAt]);
    },
    async scoreDistribution(target) {
      const rows = await query<{ rating: number; count: number | string }>(
        "SELECT rating, count(*) AS count FROM reviews WHERE target_type = $1 AND target_id = $2 AND state = 'published' AND verified = true GROUP BY rating",
        [target.targetType, target.targetId],
      );
      const distribution: Record<Rating, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      for (const row of rows) distribution[row.rating as Rating] = Number(row.count);
      return distribution;
    },
  };
}
