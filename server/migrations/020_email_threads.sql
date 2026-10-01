-- Every email from one plan to one person continues one conversation (Message-ID / In-Reply-To /
-- References for Gmail and most clients, Thread-Index for Outlook).
ALTER TABLE outbound_emails ADD COLUMN thread_key text;
ALTER TABLE outbound_emails ADD COLUMN message_id text;
ALTER TABLE outbound_emails ADD COLUMN in_reply_to text;
ALTER TABLE outbound_emails ADD COLUMN references_ids text[];
ALTER TABLE outbound_emails ADD COLUMN thread_index text;
CREATE INDEX outbound_emails_thread_idx ON outbound_emails (thread_key, created_at) WHERE thread_key IS NOT NULL;
