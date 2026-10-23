export function followsMigration(): string {
  return `
CREATE TABLE follows (
  subject_id text NOT NULL,
  target_type text NOT NULL CHECK (length(target_type) BETWEEN 1 AND 100),
  target_id text NOT NULL,
  created_at timestamptz NOT NULL,
  preferences jsonb NOT NULL CHECK (jsonb_typeof(preferences) = 'object'),
  muted boolean NOT NULL DEFAULT false,
  PRIMARY KEY (subject_id, target_type, target_id)
);
CREATE INDEX follows_target ON follows(target_type, target_id, created_at, subject_id);
CREATE INDEX follows_subject ON follows(subject_id, created_at, target_type, target_id);
`;
}
