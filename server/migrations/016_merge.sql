-- Templates workspace (mail merge): a Word template with {{tags}}, each tag mapped to a column of
-- an uploaded spreadsheet; every row becomes a document (and optionally an email).
CREATE TABLE merge_templates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  description      text NOT NULL DEFAULT '',
  file_name        text NOT NULL,
  docx             bytea NOT NULL,
  tags             text[] NOT NULL DEFAULT '{}',
  mapping          jsonb NOT NULL DEFAULT '{}',   -- { tag: { source, column?, text?, format? } }
  filters          jsonb NOT NULL DEFAULT '[]',   -- [{ column, op, value? }]
  email            jsonb NOT NULL DEFAULT '{}',   -- { toColumn?, subject?, body?, attach? }
  filename_pattern text NOT NULL DEFAULT '',
  sheet            text,                          -- sheet name remembered for next month's file
  department_id    uuid REFERENCES departments(id) ON DELETE SET NULL,
  shared           boolean NOT NULL DEFAULT false, -- visible to every department
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- One upload of data for a template. Row records hold the spreadsheet values (may be customer
-- PII) and are purged after `merge_retention_days`; the send log is kept.
CREATE TABLE merge_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id  uuid NOT NULL REFERENCES merge_templates(id) ON DELETE CASCADE,
  source_file  text,
  sheet        text,
  headers      text[] NOT NULL DEFAULT '{}',
  run_date     date NOT NULL DEFAULT current_date,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  purged_at    timestamptz
);
CREATE INDEX merge_runs_template_idx ON merge_runs (template_id, created_at DESC);

CREATE TABLE merge_rows (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id         uuid NOT NULL REFERENCES merge_runs(id) ON DELETE CASCADE,
  row_no         int NOT NULL,
  record         jsonb,                -- NULL once purged
  excluded       boolean NOT NULL DEFAULT false,
  delivery       text CHECK (delivery IN ('queued', 'sent', 'failed')),
  delivery_to    text,
  delivery_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  delivery_error text,
  delivered_at   timestamptz
);
CREATE INDEX merge_rows_run_idx ON merge_rows (run_id, row_no);
CREATE INDEX merge_rows_queue_idx ON merge_rows (delivery) WHERE delivery = 'queued';

CREATE TABLE merge_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id     uuid REFERENCES merge_runs(id) ON DELETE SET NULL,
  template   text,
  at         timestamptz NOT NULL DEFAULT now(),
  actor_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  mode       text NOT NULL CHECK (mode IN ('documents', 'drafts', 'test', 'live')),
  row_no     int,
  recipient  text,
  status     text NOT NULL
);
CREATE INDEX merge_log_run_idx ON merge_log (run_id, at);
