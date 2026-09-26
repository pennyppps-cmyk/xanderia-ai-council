-- Company memory: what the council learns from as more people use it.
-- 1. Past decisions are found by meaning, so their outcomes inform similar questions.
ALTER TABLE decisions ADD COLUMN embedding vector(768);

-- 2. Approved answers: staff suggest an answer they found useful; a department lead or admin
--    approves it (optionally edited). Only approved answers are shown to the council.
CREATE TABLE approved_answers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_message_id  uuid UNIQUE REFERENCES messages(id) ON DELETE SET NULL,
  department_id      uuid REFERENCES departments(id) ON DELETE CASCADE,  -- NULL = company-wide
  question           text NOT NULL,
  answer             text NOT NULL,
  status             text NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested', 'approved', 'rejected')),
  suggested_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at        timestamptz,
  note               text,
  embedding          vector(768),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX approved_answers_status_idx ON approved_answers (status, department_id);

-- 3. House rules: short facts a lead writes once; always given to the council for that department.
CREATE TABLE house_rules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id  uuid REFERENCES departments(id) ON DELETE CASCADE,  -- NULL = every department
  text           text NOT NULL CHECK (length(text) BETWEEN 5 AND 500),
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX house_rules_dept_idx ON house_rules (department_id) WHERE is_active;
