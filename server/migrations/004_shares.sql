-- Share a finished answer or verdict with a colleague (read-only; the colleague must be signed in).
CREATE TABLE message_shares (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token       text NOT NULL UNIQUE,
  message_id  uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  created_by  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz
);
CREATE INDEX message_shares_message_idx ON message_shares (message_id) WHERE revoked_at IS NULL;
