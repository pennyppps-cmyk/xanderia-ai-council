-- Council templates: guided starters that ask for the facts the council needs.
CREATE TABLE council_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key             text NOT NULL UNIQUE,
  title           text NOT NULL,
  title_ms        text,
  description     text,
  description_ms  text,
  -- 'council' | 'quick' | 'check' (a Quick answer with a special task, e.g. the script checker)
  mode            text NOT NULL DEFAULT 'council' CHECK (mode IN ('council', 'quick', 'check')),
  department_slug text,
  -- [{ key, label, label_ms, placeholder, placeholder_ms, multiline, required }]
  fields          jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Task prompt key used instead of the default (e.g. 'script_check'); set by admins only.
  task            text,
  persona         text,
  sort_order      integer NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);
