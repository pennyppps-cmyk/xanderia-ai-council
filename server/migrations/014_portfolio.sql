-- Monthly portfolio snapshots: the computed aggregates of a loan export (never account rows),
-- plus the council's commentary, so the report can show trends month to month.
CREATE TABLE portfolio_snapshots (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month       text NOT NULL UNIQUE CHECK (month ~ '^\d{4}-\d{2}$'),
  summary     jsonb NOT NULL,
  commentary  text,
  source_file text,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
