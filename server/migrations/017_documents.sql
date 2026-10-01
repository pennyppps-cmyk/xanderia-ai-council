-- Official documents (executive brief, board paper) written section by section from a council
-- verdict, on the company letterhead. Approval locks a document and gives it a reference number.
CREATE TABLE official_documents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Kept when retention deletes the conversation: an approved document is a company record.
  message_id     uuid REFERENCES messages(id) ON DELETE SET NULL,
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  department_id  uuid REFERENCES departments(id),
  doc_type       text NOT NULL CHECK (doc_type IN ('exec_brief', 'board_paper')),
  language       text NOT NULL CHECK (language IN ('en', 'ms')),
  subject        text NOT NULL,
  addressed_to   text NOT NULL DEFAULT '',
  status         text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'writing', 'draft', 'approved', 'error')),
  -- Snapshot of the outline at creation plus the text: [{ key, heading, kind, guide, content, status }]
  sections       jsonb NOT NULL DEFAULT '[]',
  error          text,
  ref_no         text UNIQUE,
  approved_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX official_documents_creator_idx ON official_documents (created_by, created_at DESC);
CREATE INDEX official_documents_dept_idx ON official_documents (department_id, created_at DESC);

-- Running number per reference code and year: XB/EXEC/2026/014.
CREATE TABLE doc_ref_counters (
  code  text NOT NULL,
  year  int NOT NULL,
  last  int NOT NULL,
  PRIMARY KEY (code, year)
);

-- The letterhead every document is built on (one row; without it the shipped file is used).
CREATE TABLE document_letterhead (
  id           int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  file_name    text NOT NULL,
  docx         bytea NOT NULL,
  uploaded_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at  timestamptz NOT NULL DEFAULT now()
);
