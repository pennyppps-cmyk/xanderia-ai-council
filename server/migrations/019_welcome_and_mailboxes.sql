-- Welcome email with a temporary password, and each user's own Microsoft mailbox for sending.

-- A temporary password must be changed at first sign-in, and stops working after it expires.
ALTER TABLE users ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN temp_password_expires_at timestamptz;

-- One connected Microsoft 365 mailbox per user (delegated Mail.Send). Tokens are AES-256-GCM encrypted.
CREATE TABLE user_mailboxes (
  user_id            uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  provider           text NOT NULL DEFAULT 'microsoft' CHECK (provider IN ('microsoft')),
  address            text NOT NULL,
  display_name       text,
  refresh_token_enc  text NOT NULL,
  access_token_enc   text,
  access_expires_at  timestamptz,
  -- 'expired': Microsoft refused the refresh token (password change, revoked consent); the user must reconnect.
  status             text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'expired')),
  last_error         text,
  connected_at       timestamptz NOT NULL DEFAULT now(),
  last_used_at       timestamptz
);

-- Who the email is from. Set: sent from that user's mailbox (held until it is connected).
-- Null: a system email, sent through MAIL_PROVIDER.
ALTER TABLE outbound_emails ADD COLUMN sender_user_id uuid REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX outbound_emails_sender_idx ON outbound_emails (sender_user_id) WHERE status = 'queued';
