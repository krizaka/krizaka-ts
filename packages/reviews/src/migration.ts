export function reviewsMigration(): string {
  return `
CREATE TABLE reviews (
  id uuid PRIMARY KEY,
  subject_id text NOT NULL,
  target_type text NOT NULL CHECK (length(target_type) BETWEEN 1 AND 100),
  target_id text NOT NULL,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  text text CHECK (text IS NULL OR length(text) <= 1000),
  verified boolean NOT NULL,
  state text NOT NULL CHECK (state IN ('published', 'hidden_by_owner', 'removed_by_admin', 'pending')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  owner_reply text,
  owner_replied_at timestamptz,
  UNIQUE (subject_id, target_type, target_id)
);
CREATE INDEX reviews_target_created ON reviews(target_type, target_id, created_at DESC, id);
CREATE INDEX reviews_score ON reviews(target_type, target_id, rating) WHERE state = 'published' AND verified;
`;
}
