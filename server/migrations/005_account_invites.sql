-- Account invites and password resets by email link.
CREATE TABLE password_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Only a SHA-256 of the token is stored; the token itself exists only in the email link.
  token_hash  text NOT NULL UNIQUE,
  purpose     text NOT NULL CHECK (purpose IN ('invite', 'reset')),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_tokens_user_idx ON password_tokens (user_id) WHERE used_at IS NULL;

-- Account emails (invite / reset) go through the same outbox as Action Crew emails.
ALTER TABLE outbound_emails DROP CONSTRAINT IF EXISTS outbound_emails_kind_check;
ALTER TABLE outbound_emails ADD CONSTRAINT outbound_emails_kind_check CHECK (kind IN ('task', 'reminder', 'escalation', 'account'));
