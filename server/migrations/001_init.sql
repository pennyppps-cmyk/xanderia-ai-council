-- Xanderia Council — initial schema
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TYPE user_role AS ENUM ('employee', 'dept_lead', 'admin');

-- ── Organisation ─────────────────────────────────────────────────────────────
CREATE TABLE departments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                 text NOT NULL UNIQUE,
  name                 text NOT NULL,
  name_ms              text,
  description          text,
  -- Legal / Finance answers carry a "review before acting" flag in the UI.
  review_before_acting boolean NOT NULL DEFAULT false,
  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text NOT NULL,
  password_hash  text,                                 -- null for SSO-only users
  auth_provider  text NOT NULL DEFAULT 'password',     -- 'password' | 'google' | 'microsoft'
  external_id    text,                                 -- SSO subject id
  display_name   text NOT NULL,
  role           user_role NOT NULL DEFAULT 'employee',
  department_id  uuid NOT NULL REFERENCES departments(id),
  locale         text NOT NULL DEFAULT 'en',
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz
);
CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email));

-- Cross-department knowledge access granted by an admin.
CREATE TABLE user_department_access (
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_id  uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  granted_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, department_id)
);

-- ── Conversations ────────────────────────────────────────────────────────────
CREATE TABLE conversations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_id  uuid NOT NULL REFERENCES departments(id),
  title          text NOT NULL DEFAULT 'New conversation',
  pinned         boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversations_user_idx ON conversations (user_id, pinned DESC, updated_at DESC);

CREATE TABLE messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role             text NOT NULL CHECK (role IN ('user', 'assistant')),
  content          text NOT NULL DEFAULT '',
  -- assistant messages only ↓
  reply_to         uuid REFERENCES messages(id) ON DELETE CASCADE,
  requested_mode   text CHECK (requested_mode IN ('auto', 'quick', 'council')),
  mode             text CHECK (mode IN ('quick', 'council')),
  department_id    uuid REFERENCES departments(id),
  status           text NOT NULL DEFAULT 'done' CHECK (status IN ('queued', 'running', 'done', 'error')),
  stage            text,
  options          jsonb NOT NULL DEFAULT '{}'::jsonb,
  router           jsonb,
  verdict          jsonb,
  citations        jsonb,
  cloud_used       boolean NOT NULL DEFAULT false,
  error            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz
);
CREATE INDEX messages_conversation_idx ON messages (conversation_id, created_at);
CREATE INDEX messages_content_search_idx ON messages USING gin (to_tsvector('simple', content));

-- Individual advisor opinions (stage 1) and peer reviews (stage 2).
CREATE TABLE message_parts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id   uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  stage        smallint NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('opinion', 'review')),
  persona_key  text NOT NULL,
  anon_label   text,
  content      text NOT NULL,
  data         jsonb,
  model        text,
  latency_ms   integer,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX message_parts_message_idx ON message_parts (message_id, stage);

CREATE TABLE feedback (
  message_id  uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating      smallint NOT NULL CHECK (rating IN (-1, 1)),
  comment     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

-- ── Personas & layered prompts ───────────────────────────────────────────────
CREATE TABLE personas (
  key          text PRIMARY KEY,
  name         text NOT NULL,
  name_ms      text,
  description  text,
  in_council   boolean NOT NULL DEFAULT false,   -- takes part in stage 1
  sort_order   integer NOT NULL DEFAULT 0,
  is_active    boolean NOT NULL DEFAULT true
);

-- Prompt layers: base → persona → department → task. Versioned; one active per (layer, key).
CREATE TABLE prompt_components (
  id          bigserial PRIMARY KEY,
  layer       text NOT NULL CHECK (layer IN ('base', 'persona', 'department', 'task')),
  key         text NOT NULL,
  version     integer NOT NULL,
  content     text NOT NULL,
  is_active   boolean NOT NULL DEFAULT false,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (layer, key, version)
);
CREATE UNIQUE INDEX prompt_components_active_idx ON prompt_components (layer, key) WHERE is_active;

-- ── Model layer ──────────────────────────────────────────────────────────────
CREATE TABLE providers (
  id            text PRIMARY KEY,
  kind          text NOT NULL CHECK (kind IN ('ollama', 'openai_compatible')),
  base_url      text NOT NULL,
  -- Name of the env var holding the secret (secrets never live in the DB).
  api_key_env   text,
  is_cloud      boolean NOT NULL DEFAULT false,
  enabled       boolean NOT NULL DEFAULT true,
  max_parallel  integer NOT NULL DEFAULT 2,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE model_roles (
  role         text PRIMARY KEY,
  provider_id  text NOT NULL REFERENCES providers(id),
  model        text NOT NULL,
  temperature  real NOT NULL DEFAULT 0.5,
  num_ctx      integer NOT NULL DEFAULT 16384,
  num_predict  integer NOT NULL DEFAULT 600,
  keep_alive   text NOT NULL DEFAULT '30m',
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ── Knowledge (RAG) ──────────────────────────────────────────────────────────
CREATE TABLE documents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id    uuid REFERENCES departments(id) ON DELETE CASCADE,
  company_wide     boolean NOT NULL DEFAULT false,
  title            text NOT NULL,
  source_filename  text,
  uploaded_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  chunk_count      integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (department_id IS NOT NULL OR company_wide)
);

-- nomic-embed-text produces 768-dim vectors. Changing embedding model = new migration + re-embed.
CREATE TABLE document_chunks (
  id           bigserial PRIMARY KEY,
  document_id  uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index  integer NOT NULL,
  section      text,
  content      text NOT NULL,
  embedding    vector(768) NOT NULL
);
CREATE INDEX document_chunks_embedding_idx ON document_chunks USING hnsw (embedding vector_cosine_ops);

-- ── Audit (append-only) ──────────────────────────────────────────────────────
CREATE TABLE audit_log (
  id             bigserial PRIMARY KEY,
  at             timestamptz NOT NULL DEFAULT now(),
  actor_user_id  uuid,              -- deliberately no FK: rows must outlive users
  action         text NOT NULL,
  target_type    text,
  target_id      text,
  detail         jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip             text
);
CREATE INDEX audit_log_at_idx ON audit_log (at DESC);
CREATE INDEX audit_log_action_idx ON audit_log (action, at DESC);

-- Rows can never be updated. Deletes are only allowed by the retention job,
-- which sets `xanderia.audit_purge = 'on'` inside its own transaction.
CREATE FUNCTION audit_log_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('xanderia.audit_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_immutable
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_guard();

CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_guard();

-- ── Settings ─────────────────────────────────────────────────────────────────
CREATE TABLE settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
