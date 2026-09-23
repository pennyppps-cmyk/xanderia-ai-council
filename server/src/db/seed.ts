import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { pool, tx } from './pool.js';
import { BASE_PROMPT, DEPARTMENTS, MODEL_ROLES, PERSONAS, SETTINGS, TASKS } from './seedData.js';

/** Idempotent: only inserts rows that do not exist yet, never overwrites admin edits. */
export async function seed(log = console.log) {
  await tx(async (c) => {
    // api and worker both seed on boot; serialise them.
    await c.query('SELECT pg_advisory_xact_lock(727002)');
    for (const d of DEPARTMENTS) {
      await c.query(
        `INSERT INTO departments (slug, name, name_ms, description, review_before_acting)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (slug) DO NOTHING`,
        [d.slug, d.name, d.name_ms, d.description, d.review],
      );
    }

    for (const [i, p] of PERSONAS.entries()) {
      await c.query(
        `INSERT INTO personas (key, name, name_ms, description, in_council, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (key) DO NOTHING`,
        [p.key, p.name, p.name_ms, p.description, p.in_council, i],
      );
    }

    const prompts: Array<[string, string, string]> = [
      ['base', 'default', BASE_PROMPT],
      ...PERSONAS.map((p) => ['persona', p.key, p.prompt] as [string, string, string]),
      ...DEPARTMENTS.map((d) => ['department', d.slug, d.prompt] as [string, string, string]),
      ...Object.entries(TASKS).map(([k, v]) => ['task', k, v] as [string, string, string]),
    ];
    for (const [layer, key, content] of prompts) {
      await c.query(
        `INSERT INTO prompt_components (layer, key, version, content, is_active)
         SELECT $1, $2, 1, $3, true
         WHERE NOT EXISTS (SELECT 1 FROM prompt_components WHERE layer = $1 AND key = $2)`,
        [layer, key, content],
      );
    }

    // Base URL is resolved from the environment at runtime, so .env stays the source of truth.
    await c.query(
      `INSERT INTO providers (id, kind, base_url, api_key_env, is_cloud, enabled, max_parallel)
       VALUES ('ollama', 'ollama', '\${OLLAMA_BASE_URL}', 'OLLAMA_API_KEY', false, true, $1)
       ON CONFLICT (id) DO NOTHING`,
      [config.OLLAMA_NUM_PARALLEL],
    );
    // Stub for the optional hybrid Chairman (§5.6). Disabled; enabling it is an admin decision.
    await c.query(
      `INSERT INTO providers (id, kind, base_url, api_key_env, is_cloud, enabled, max_parallel)
       VALUES ('cloud', 'openai_compatible', 'https://api.example.com/v1', 'CLOUD_API_KEY', true, false, 4)
       ON CONFLICT (id) DO NOTHING`,
    );

    for (const r of MODEL_ROLES) {
      await c.query(
        `INSERT INTO model_roles (role, provider_id, model, temperature, num_ctx, num_predict, keep_alive)
         VALUES ($1, 'ollama', $2, $3, 16384, $4, '30m') ON CONFLICT (role) DO NOTHING`,
        [r.role, config.DEFAULT_CHAT_MODEL, r.temperature, r.num_predict],
      );
    }
    await c.query(
      `INSERT INTO model_roles (role, provider_id, model, temperature, num_ctx, num_predict, keep_alive)
       VALUES ('embedding', 'ollama', $1, 0, 2048, 0, '30m') ON CONFLICT (role) DO NOTHING`,
      [config.DEFAULT_EMBED_MODEL],
    );

    const settings = {
      ...SETTINGS,
      local_fallback: { provider_id: 'ollama', model: config.DEFAULT_CHAT_MODEL },
    };
    for (const [key, value] of Object.entries(settings)) {
      await c.query(
        `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
        [key, JSON.stringify(value)],
      );
    }

    const { rows } = await c.query('SELECT count(*)::int AS n FROM users');
    if (rows[0].n === 0) {
      const dept = await c.query('SELECT id FROM departments WHERE slug = $1', [config.ADMIN_DEPARTMENT]);
      if (!dept.rows[0]) throw new Error(`ADMIN_DEPARTMENT "${config.ADMIN_DEPARTMENT}" does not exist`);
      await c.query(
        `INSERT INTO users (email, password_hash, display_name, role, department_id)
         VALUES ($1, $2, 'Administrator', 'admin', $3)`,
        [config.ADMIN_EMAIL.toLowerCase(), await bcrypt.hash(config.ADMIN_PASSWORD, 12), dept.rows[0].id],
      );
      log(`[seed] created admin ${config.ADMIN_EMAIL}`);
    }
  });
  log('[seed] done');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  seed()
    .then(() => pool.end())
    .then(
      () => process.exit(0),
      (err) => {
        console.error(err);
        process.exit(1);
      },
    );
}
