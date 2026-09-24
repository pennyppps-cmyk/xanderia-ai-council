-- Decision register: verdicts people chose to act on, with outcome check-ins.
CREATE TABLE decisions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id     uuid NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
  recorded_by    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_id  uuid REFERENCES departments(id),
  title          text NOT NULL,
  summary        text NOT NULL,
  -- who can see it: the department, or the whole company
  visibility     text NOT NULL DEFAULT 'department' CHECK (visibility IN ('department', 'company')),
  status         text NOT NULL DEFAULT 'decided' CHECK (status IN ('decided', 'in_progress', 'done', 'dropped')),
  decided_at     timestamptz NOT NULL DEFAULT now(),
  -- remaining check-ins, in days after the decision (e.g. {30,60})
  check_in_days  integer[] NOT NULL DEFAULT '{30,60}',
  next_check_in  date,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX decisions_dept_idx ON decisions (department_id, decided_at DESC);

CREATE TABLE decision_outcomes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id  uuid NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  rating       text NOT NULL CHECK (rating IN ('worked', 'partly', 'did_not_work', 'too_early')),
  note         text,
  recorded_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX decision_outcomes_idx ON decision_outcomes (decision_id, created_at DESC);

-- General notification emails (check-ins, weekly digests) through the same outbox.
ALTER TABLE outbound_emails DROP CONSTRAINT IF EXISTS outbound_emails_kind_check;
ALTER TABLE outbound_emails ADD CONSTRAINT outbound_emails_kind_check
  CHECK (kind IN ('task', 'reminder', 'escalation', 'account', 'digest', 'checkin'));
