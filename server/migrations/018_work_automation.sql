-- Work automation: plans that do not come from a council verdict (routines, data, meetings),
-- recurring routines, meeting minutes, staff availability, quarterly goals and the weekly emails.

-- ── Plans from other sources ──
ALTER TABLE action_plans ALTER COLUMN message_id DROP NOT NULL;
ALTER TABLE action_plans ALTER COLUMN conversation_id DROP NOT NULL;
ALTER TABLE action_plans ADD COLUMN source text NOT NULL DEFAULT 'council'
  CHECK (source IN ('council', 'routine', 'data', 'meeting'));
ALTER TABLE action_plans ADD COLUMN source_id uuid;
-- Why the work matters, for task emails and the Runner when there is no verdict.
ALTER TABLE action_plans ADD COLUMN context text;
CREATE INDEX action_plans_source_idx ON action_plans (source, source_id);

-- ── Recurring routines ──
CREATE TABLE routines (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  description    text NOT NULL DEFAULT '',
  department_id  uuid REFERENCES departments(id) ON DELETE SET NULL,
  -- The manager who approves each cycle's tasks and is told when something is late.
  owner_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  frequency      text NOT NULL CHECK (frequency IN ('weekly', 'monthly', 'quarterly')),
  -- The working day of the period on which the cycle's tasks are created (1 = first working day).
  run_day        int NOT NULL DEFAULT 1 CHECK (run_day BETWEEN 1 AND 60),
  -- false: each cycle waits for the owner's approval; true: tasks go out by themselves.
  auto_launch    boolean NOT NULL DEFAULT false,
  active         boolean NOT NULL DEFAULT true,
  last_period    text,
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE routine_steps (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  routine_id    uuid NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  seq           int NOT NULL,
  title         text NOT NULL,
  description   text NOT NULL DEFAULT '',
  owner_type    text NOT NULL DEFAULT 'human' CHECK (owner_type IN ('human', 'agent')),
  owner_role    text NOT NULL DEFAULT '',
  directory_id  uuid REFERENCES staff_directory(id) ON DELETE SET NULL,
  -- Due on this working day of the period (e.g. 3 = the 3rd working day of the month).
  due_day       int NOT NULL DEFAULT 1 CHECK (due_day BETWEEN 1 AND 60),
  -- Steps that must be done first; the task is only sent once they are.
  depends_on    int[] NOT NULL DEFAULT '{}',
  UNIQUE (routine_id, seq)
);

-- ── Staff availability ──
ALTER TABLE staff_directory ADD COLUMN away_until date;
ALTER TABLE staff_directory ADD COLUMN backup_id uuid REFERENCES staff_directory(id) ON DELETE SET NULL;

-- ── Meetings ──
CREATE TABLE meetings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title          text NOT NULL,
  held_on        date NOT NULL,
  department_id  uuid REFERENCES departments(id) ON DELETE SET NULL,
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  language       text NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'ms')),
  attendees      uuid[] NOT NULL DEFAULT '{}',   -- staff_directory ids
  notes          text NOT NULL DEFAULT '',       -- typed notes or the transcript of a recording
  -- { summary, decisions[], actions[{ task, owner, directory_id, due_date }], open_points[] }
  minutes        jsonb,
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'writing', 'minuted', 'error')),
  error          text,
  plan_id        uuid REFERENCES action_plans(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX meetings_creator_idx ON meetings (created_by, held_on DESC);

-- ── Quarterly goals ──
CREATE TABLE goals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title          text NOT NULL,
  description    text NOT NULL DEFAULT '',
  quarter        text NOT NULL CHECK (quarter ~ '^\d{4}-Q[1-4]$'),
  department_id  uuid REFERENCES departments(id) ON DELETE SET NULL,  -- NULL = company-wide
  owner_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  -- 'manual' (updated by check-ins) or a figure read from the latest portfolio snapshot.
  metric_source  text NOT NULL DEFAULT 'manual' CHECK (metric_source IN ('manual', 'npl_ratio', 'par30')),
  metric         text NOT NULL DEFAULT '',
  unit           text NOT NULL DEFAULT '',
  baseline       numeric,
  target         numeric,
  current        numeric,
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'achieved', 'missed', 'dropped')),
  message_id     uuid REFERENCES messages(id) ON DELETE SET NULL,     -- the council run that planned it
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX goals_quarter_idx ON goals (quarter, department_id);

CREATE TABLE goal_checkins (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id      uuid NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  value        numeric,
  note         text NOT NULL DEFAULT '',
  recorded_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ── Portfolio limits: one automatic council run per month at most ──
ALTER TABLE portfolio_snapshots ADD COLUMN alert_message_id uuid REFERENCES messages(id) ON DELETE SET NULL;

-- ── Weekly plan (Monday) and check-in (Friday) emails ──
ALTER TABLE outbound_emails DROP CONSTRAINT IF EXISTS outbound_emails_kind_check;
ALTER TABLE outbound_emails ADD CONSTRAINT outbound_emails_kind_check
  CHECK (kind IN ('task', 'reminder', 'escalation', 'account', 'digest', 'checkin', 'week_plan', 'week_checkin'));
