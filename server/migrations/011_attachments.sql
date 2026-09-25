-- Documents a user attaches to one question (a plan, a proposal, a spreadsheet) for the council to judge.
-- Only the extracted text is kept, never the file; it belongs to that question alone (not the knowledge base).
CREATE TABLE attachments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id  uuid REFERENCES messages(id) ON DELETE CASCADE,  -- NULL until the question is sent
  filename    text NOT NULL,
  bytes       integer NOT NULL,
  chars       integer NOT NULL,
  sha256      text NOT NULL,
  text        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attachments_message_idx ON attachments (message_id);
CREATE INDEX attachments_unsent_idx ON attachments (user_id, created_at) WHERE message_id IS NULL;
