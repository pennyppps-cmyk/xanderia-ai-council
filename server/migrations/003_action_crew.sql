-- Action Crew (HANDOFF §14): turn a council verdict into owned, tracked tasks.

-- Staff directory, imported from HR (CSV) and editable by admins. The only source of
-- people and email addresses: the model never invents either.
CREATE TABLE staff_directory (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  position       text NOT NULL,
  department_id  uuid REFERENCES departments(id) ON DELETE SET NULL,
  email          text NOT NULL,
  manager_email  text,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX staff_directory_email_idx ON staff_directory (lower(email));

CREATE TABLE action_plans (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id      uuid NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  requester_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_id   uuid REFERENCES departments(id),
  title           text NOT NULL,
  -- planning → ready (awaiting approval) → launched → done | cancelled ; error if the Dispatcher failed
  status          text NOT NULL DEFAULT 'planning'
                  CHECK (status IN ('planning', 'ready', 'launched', 'done', 'cancelled', 'error')),
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  launched_at     timestamptz
);
CREATE INDEX action_plans_requester_idx ON action_plans (requester_id, created_at DESC);

CREATE TABLE action_tasks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id          uuid NOT NULL REFERENCES action_plans(id) ON DELETE CASCADE,
  seq              integer NOT NULL,
  title            text NOT NULL,
  description      text NOT NULL DEFAULT '',
  owner_type       text NOT NULL CHECK (owner_type IN ('human', 'agent')),
  owner_role       text,
  directory_id     uuid REFERENCES staff_directory(id) ON DELETE SET NULL,
  -- 'resolved' (one match), 'choose' (several candidates), 'unassigned' (no match), 'agent'
  resolution       text NOT NULL DEFAULT 'unassigned',
  candidates       jsonb NOT NULL DEFAULT '[]'::jsonb,
  depends_on       integer[] NOT NULL DEFAULT '{}',
  due_date         date,
  -- draft → sent → accepted → in_progress → done ; blocked / cant_do / cancelled
  -- agent tasks: draft → running → review → done
  status           text NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft', 'sent', 'accepted', 'in_progress', 'running', 'review', 'done', 'blocked', 'cant_do', 'cancelled')),
  email_subject    text,
  email_body       text,
  approved         boolean NOT NULL DEFAULT false,
  response_note    text,
  agent_output     text,
  sent_at          timestamptz,
  acknowledged_at  timestamptz,
  completed_at     timestamptz,
  ack_reminded_at  timestamptz,
  due_reminded_at  timestamptz,
  nudged_at        timestamptz,
  escalation_state text NOT NULL DEFAULT 'none' CHECK (escalation_state IN ('none', 'pending', 'sent', 'declined')),
  escalated_at     timestamptz,
  snoozed_until    timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, seq)
);
CREATE INDEX action_tasks_directory_idx ON action_tasks (directory_id);
CREATE INDEX action_tasks_status_idx ON action_tasks (status);

CREATE TABLE task_events (
  id          bigserial PRIMARY KEY,
  task_id     uuid NOT NULL REFERENCES action_tasks(id) ON DELETE CASCADE,
  at          timestamptz NOT NULL DEFAULT now(),
  kind        text NOT NULL,
  actor       text,
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX task_events_task_idx ON task_events (task_id, at);

-- Every email goes through this outbox. The sender job delivers queued rows during
-- business hours via the configured provider ('outbox' = record only, never sent).
CREATE TABLE outbound_emails (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     uuid REFERENCES action_tasks(id) ON DELETE SET NULL,
  kind        text NOT NULL CHECK (kind IN ('task', 'reminder', 'escalation')),
  to_email    text NOT NULL,
  subject     text NOT NULL,
  body_text   text NOT NULL,
  body_html   text NOT NULL,
  status      text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'logged', 'failed', 'blocked')),
  provider    text,
  error       text,
  send_after  timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz
);
CREATE INDEX outbound_emails_queue_idx ON outbound_emails (status, send_after);

-- In-app notifications (requester nudges, status updates, escalation approvals).
CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  title       text NOT NULL,
  body        text,
  link        text,
  task_id     uuid REFERENCES action_tasks(id) ON DELETE CASCADE,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, read_at, created_at DESC);

-- Public holidays: no emails and no working-day counting on these dates.
CREATE TABLE holidays (
  date  date PRIMARY KEY,
  name  text NOT NULL
);
