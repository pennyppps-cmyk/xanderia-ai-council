-- Knowledge freshness: every document is due for review N days after upload / last review.
ALTER TABLE documents
  ADD COLUMN review_after_days integer NOT NULL DEFAULT 180 CHECK (review_after_days BETWEEN 7 AND 1095),
  ADD COLUMN reviewed_at       timestamptz,
  ADD COLUMN reviewed_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN stale_notified_at timestamptz;

-- Weekly digest: department heads can opt out.
ALTER TABLE users ADD COLUMN weekly_digest boolean NOT NULL DEFAULT true;
