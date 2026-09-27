-- Notis blast (Collections): monthly "Notis Potongan Gaji Tidak Berjaya" letters from the masterlist.
-- Row data holds customer PII; it is purged after `notis_retention_days`. The send log is kept
-- (dispute records) and follows the normal audit retention.
CREATE TABLE notis_batches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  source_file   text,
  sheet         text,
  notice_date   date NOT NULL DEFAULT current_date,
  as_of_default date,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  purged_at     timestamptz
);

CREATE TABLE notis_rows (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id       uuid NOT NULL REFERENCES notis_batches(id) ON DELETE CASCADE,
  row_no         int NOT NULL,
  state          text NOT NULL CHECK (state IN ('ready', 'held', 'no_email', 'incomplete')),
  included       boolean NOT NULL DEFAULT false,
  account_number text,
  customer_name  text,
  email          text,
  data           jsonb,              -- letter fields (IC, address, amounts); NULL once purged
  reasons        text[] NOT NULL DEFAULT '{}',
  warnings       text[] NOT NULL DEFAULT '{}',
  delivery       text CHECK (delivery IN ('queued', 'sent', 'failed')),
  delivery_to    text,
  delivery_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  delivery_error text,
  delivered_at   timestamptz
);
CREATE INDEX notis_rows_batch_idx ON notis_rows (batch_id, row_no);
CREATE INDEX notis_rows_queue_idx ON notis_rows (delivery) WHERE delivery = 'queued';

CREATE TABLE notis_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id       uuid REFERENCES notis_batches(id) ON DELETE SET NULL,
  at             timestamptz NOT NULL DEFAULT now(),
  actor_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  mode           text NOT NULL CHECK (mode IN ('drafts', 'pdfs', 'test', 'live')),
  account_number text,
  customer_name  text,
  recipient      text,
  status         text NOT NULL
);
CREATE INDEX notis_log_batch_idx ON notis_log (batch_id, at);
