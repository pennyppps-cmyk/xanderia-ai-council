import bcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { writeAudit } from '../audit.js';
import { query, tx } from '../db/pool.js';
import { clearRegistryCache } from '../llm/registry.js';
import { invalidatePrompts } from '../prompts/assembler.js';
import { runPromptSandbox } from '../prompts/sandbox.js';
import { sendAccountLink } from '../account.js';
import { allSettings, setSetting } from '../settings.js';
import { digestFor, digestParagraphs, weeklyDigests } from '../jobs.js';

const Uuid = z.object({ id: z.string().uuid() });
const Role = z.enum(['employee', 'dept_lead', 'admin']);

function adminAudit(req: FastifyRequest, action: string, detail: Record<string, unknown>, targetId?: string) {
  return writeAudit({ actorUserId: req.user.id, action, detail, targetId, ip: req.ip });
}

export default async function adminRoutes(app: FastifyInstance) {
  const admin = { preHandler: app.requireRole('admin') };

  // ── Users ──
  app.get('/api/admin/users', admin, async () => {
    const { rows } = await query(
      `SELECT u.id, u.email, u.display_name, u.role, u.department_id, u.is_active, u.last_login_at, u.created_at, u.weekly_digest,
              (u.password_hash IS NOT NULL) AS has_password,
              COALESCE(array_agg(a.department_id) FILTER (WHERE a.department_id IS NOT NULL), '{}') AS extra_departments
         FROM users u LEFT JOIN user_department_access a ON a.user_id = u.id
        GROUP BY u.id ORDER BY u.display_name`,
    );
    return rows;
  });

  app.post('/api/admin/users', admin, async (req, reply) => {
    const body = z
      .object({
        email: z.string().email(),
        display_name: z.string().trim().min(1),
        // Optional: without one, the new user sets their own password from the invite email.
        password: z.string().min(10).optional().or(z.literal('')),
        send_invite: z.boolean().default(true),
        role: Role.default('employee'),
        department_id: z.string().uuid(),
      })
      .parse(req.body);
    if (!body.password && !body.send_invite) {
      return reply.code(400).send({ error: 'Set an initial password or send an invite email' });
    }
    try {
      const { rows } = await query(
        `INSERT INTO users (email, password_hash, display_name, role, department_id)
         VALUES (lower($1), $2, $3, $4, $5) RETURNING id`,
        [body.email, body.password ? await bcrypt.hash(body.password, 12) : null, body.display_name, body.role, body.department_id],
      );
      await adminAudit(req, 'user_created', { email: body.email, role: body.role, invited: body.send_invite }, rows[0].id);
      const invite = body.send_invite
        ? await sendAccountLink(rows[0].id, body.password ? 'reset' : 'invite', { id: req.user.id, name: req.user.display_name })
        : null;
      return { id: rows[0].id, invite };
    } catch (err: any) {
      if (err.code === '23505') return reply.code(409).send({ error: 'Email already exists' });
      throw err;
    }
  });

  /** (Re)send an invite, or a reset link for someone who already has a password. */
  app.post('/api/admin/users/:id/invite', admin, async (req, reply) => {
    const { id } = Uuid.parse(req.params);
    const { rows } = await query(`SELECT password_hash IS NOT NULL AS has_password FROM users WHERE id = $1 AND is_active`, [id]);
    if (!rows[0]) return reply.code(404).send({ error: 'User not found or inactive' });
    return sendAccountLink(id, rows[0].has_password ? 'reset' : 'invite', { id: req.user.id, name: req.user.display_name });
  });

  app.patch('/api/admin/users/:id', admin, async (req, reply) => {
    const { id } = Uuid.parse(req.params);
    const body = z
      .object({
        display_name: z.string().trim().min(1).optional(),
        role: Role.optional(),
        department_id: z.string().uuid().optional(),
        is_active: z.boolean().optional(),
        password: z.string().min(10).optional(),
        extra_departments: z.array(z.string().uuid()).optional(),
        weekly_digest: z.boolean().optional(),
      })
      .parse(req.body);
    if (id === req.user.id && (body.is_active === false || (body.role && body.role !== 'admin'))) {
      return reply.code(400).send({ error: 'You cannot demote or deactivate yourself' });
    }
    await tx(async (c) => {
      await c.query(
        `UPDATE users SET display_name = COALESCE($2, display_name), role = COALESCE($3, role),
                department_id = COALESCE($4, department_id), is_active = COALESCE($5, is_active),
                password_hash = COALESCE($6, password_hash), weekly_digest = COALESCE($7, weekly_digest)
          WHERE id = $1`,
        [
          id,
          body.display_name ?? null,
          body.role ?? null,
          body.department_id ?? null,
          body.is_active ?? null,
          body.password ? await bcrypt.hash(body.password, 12) : null,
          body.weekly_digest ?? null,
        ],
      );
      if (body.extra_departments) {
        await c.query('DELETE FROM user_department_access WHERE user_id = $1', [id]);
        for (const d of body.extra_departments) {
          await c.query(
            'INSERT INTO user_department_access (user_id, department_id, granted_by) VALUES ($1, $2, $3)',
            [id, d, req.user.id],
          );
        }
      }
    });
    const { password, ...logged } = body;
    await adminAudit(req, 'user_updated', { ...logged, password_reset: Boolean(password) }, id);
    return { ok: true };
  });

  // ── Departments ──
  app.get('/api/admin/departments', admin, async () => {
    const { rows } = await query(
      `SELECT d.*, p.content AS prompt,
              (SELECT count(*)::int FROM users u WHERE u.department_id = d.id) AS user_count
         FROM departments d
         LEFT JOIN prompt_components p ON p.layer = 'department' AND p.key = d.slug AND p.is_active
        ORDER BY d.name`,
    );
    return rows;
  });

  const DeptBody = z.object({
    slug: z.string().regex(/^[a-z0-9-]+$/).optional(),
    name: z.string().trim().min(1).optional(),
    name_ms: z.string().trim().optional(),
    description: z.string().optional(),
    review_before_acting: z.boolean().optional(),
    is_active: z.boolean().optional(),
    prompt: z.string().optional(),
  });

  app.post('/api/admin/departments', admin, async (req, reply) => {
    const body = DeptBody.required({ slug: true, name: true }).parse(req.body);
    try {
      const { rows } = await query(
        `INSERT INTO departments (slug, name, name_ms, description, review_before_acting)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [body.slug, body.name, body.name_ms ?? null, body.description ?? null, body.review_before_acting ?? false],
      );
      if (body.prompt) await savePrompt('department', body.slug, body.prompt, req.user.id);
      await adminAudit(req, 'department_created', { slug: body.slug }, rows[0].id);
      return rows[0];
    } catch (err: any) {
      if (err.code === '23505') return reply.code(409).send({ error: 'Slug already exists' });
      throw err;
    }
  });

  app.patch('/api/admin/departments/:id', admin, async (req) => {
    const { id } = Uuid.parse(req.params);
    const body = DeptBody.omit({ slug: true }).parse(req.body);
    const { rows } = await query(
      `UPDATE departments SET name = COALESCE($2, name), name_ms = COALESCE($3, name_ms),
              description = COALESCE($4, description), review_before_acting = COALESCE($5, review_before_acting),
              is_active = COALESCE($6, is_active)
        WHERE id = $1 RETURNING slug`,
      [id, body.name ?? null, body.name_ms ?? null, body.description ?? null, body.review_before_acting ?? null, body.is_active ?? null],
    );
    if (body.prompt !== undefined && rows[0]) await savePrompt('department', rows[0].slug, body.prompt, req.user.id);
    await adminAudit(req, 'department_updated', { ...body, prompt: body.prompt ? '(changed)' : undefined }, id);
    return { ok: true };
  });

  // ── Personas & prompt components (versioned) ──
  app.get('/api/admin/prompts', admin, async () => {
    const { rows: personas } = await query('SELECT * FROM personas ORDER BY sort_order');
    const { rows: components } = await query(
      `SELECT p.id, p.layer, p.key, p.version, p.content, p.is_active, p.created_at, u.display_name AS created_by
         FROM prompt_components p LEFT JOIN users u ON u.id = p.created_by
        ORDER BY p.layer, p.key, p.version DESC`,
    );
    return { personas, components };
  });

  async function savePrompt(layer: string, key: string, content: string, userId: string) {
    return tx(async (c) => {
      const { rows } = await c.query(
        'SELECT COALESCE(max(version), 0) + 1 AS v FROM prompt_components WHERE layer = $1 AND key = $2',
        [layer, key],
      );
      await c.query('UPDATE prompt_components SET is_active = false WHERE layer = $1 AND key = $2', [layer, key]);
      await c.query(
        `INSERT INTO prompt_components (layer, key, version, content, is_active, created_by)
         VALUES ($1, $2, $3, $4, true, $5)`,
        [layer, key, rows[0].v, content, userId],
      );
      await invalidatePrompts();
      return rows[0].v as number;
    });
  }

  app.post('/api/admin/prompts', admin, async (req) => {
    const body = z
      .object({
        layer: z.enum(['base', 'persona', 'department', 'task']),
        key: z.string().min(1),
        content: z.string().trim().min(1).max(6000),
      })
      .parse(req.body);
    const version = await savePrompt(body.layer, body.key, body.content, req.user.id);
    await adminAudit(req, 'prompt_saved', { layer: body.layer, key: body.key, version });
    return { version };
  });

  // Run an unsaved draft of a prompt layer the way the real step uses it (nothing is saved).
  app.post('/api/admin/prompts/test', admin, async (req) => {
    const body = z
      .object({
        layer: z.enum(['base', 'persona', 'department', 'task']),
        key: z.string().min(1),
        content: z.string().trim().min(1).max(6000),
        question: z.string().trim().min(1).max(4000),
        department: z.string().default('management'),
      })
      .parse(req.body);
    const result = await runPromptSandbox({
      layer: body.layer,
      key: body.key,
      content: body.content,
      question: body.question,
      departmentSlug: body.department,
      userId: req.user.id,
    });
    await adminAudit(req, 'prompt_tested', { layer: body.layer, key: body.key, role: result.role });
    return result;
  });

  // Roll back / forward to any stored version.
  app.post('/api/admin/prompts/:id/activate', admin, async (req, reply) => {
    const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
    const ok = await tx(async (c) => {
      const { rows } = await c.query('SELECT layer, key, version FROM prompt_components WHERE id = $1', [id]);
      if (!rows[0]) return null;
      await c.query('UPDATE prompt_components SET is_active = false WHERE layer = $1 AND key = $2', [rows[0].layer, rows[0].key]);
      await c.query('UPDATE prompt_components SET is_active = true WHERE id = $1', [id]);
      return rows[0];
    });
    if (!ok) return reply.code(404).send({ error: 'Not found' });
    await invalidatePrompts();
    await adminAudit(req, 'prompt_activated', ok);
    return { ok: true };
  });

  app.patch('/api/admin/personas/:key', admin, async (req) => {
    const { key } = z.object({ key: z.string() }).parse(req.params);
    const body = z
      .object({
        name: z.string().optional(),
        name_ms: z.string().optional(),
        description: z.string().optional(),
        in_council: z.boolean().optional(),
        is_active: z.boolean().optional(),
      })
      .parse(req.body);
    await query(
      `UPDATE personas SET name = COALESCE($2, name), name_ms = COALESCE($3, name_ms),
              description = COALESCE($4, description), in_council = COALESCE($5, in_council),
              is_active = COALESCE($6, is_active) WHERE key = $1`,
      [key, body.name ?? null, body.name_ms ?? null, body.description ?? null, body.in_council ?? null, body.is_active ?? null],
    );
    await adminAudit(req, 'persona_updated', { key, ...body });
    return { ok: true };
  });

  // ── Model routing ──
  app.get('/api/admin/models', admin, async () => {
    const { rows: roles } = await query('SELECT * FROM model_roles ORDER BY role');
    const { rows: providers } = await query('SELECT * FROM providers ORDER BY id');
    return { roles, providers };
  });

  app.patch('/api/admin/models/:role', admin, async (req, reply) => {
    const { role } = z.object({ role: z.string() }).parse(req.params);
    const body = z
      .object({
        provider_id: z.string().optional(),
        model: z.string().min(1).optional(),
        temperature: z.number().min(0).max(2).optional(),
        num_ctx: z.number().int().min(512).max(262144).optional(),
        num_predict: z.number().int().min(0).max(32768).optional(),
        keep_alive: z.string().regex(/^(-?\d+|\d+[smh])$/).optional(),
      })
      .parse(req.body);
    if (body.provider_id) {
      const { rows } = await query('SELECT is_cloud FROM providers WHERE id = $1', [body.provider_id]);
      if (!rows[0]) return reply.code(400).send({ error: 'Unknown provider' });
      if (rows[0].is_cloud && (role === 'router' || role === 'embedding')) {
        return reply.code(400).send({ error: `The ${role} role reads raw messages and must stay on-premises` });
      }
    }
    await query(
      `UPDATE model_roles SET provider_id = COALESCE($2, provider_id), model = COALESCE($3, model),
              temperature = COALESCE($4, temperature), num_ctx = COALESCE($5, num_ctx),
              num_predict = COALESCE($6, num_predict), keep_alive = COALESCE($7, keep_alive), updated_at = now()
        WHERE role = $1`,
      [role, body.provider_id ?? null, body.model ?? null, body.temperature ?? null, body.num_ctx ?? null, body.num_predict ?? null, body.keep_alive ?? null],
    );
    clearRegistryCache();
    await adminAudit(req, 'model_role_updated', { role, ...body });
    return { ok: true };
  });

  app.patch('/api/admin/providers/:id', admin, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z
      .object({
        base_url: z.string().min(1).optional(),
        api_key_env: z.string().regex(/^[A-Z0-9_]+$/).nullable().optional(),
        enabled: z.boolean().optional(),
        max_parallel: z.number().int().min(1).max(64).optional(),
      })
      .parse(req.body);
    await query(
      `UPDATE providers SET base_url = COALESCE($2, base_url),
              api_key_env = CASE WHEN $3::boolean THEN $4 ELSE api_key_env END,
              enabled = COALESCE($5, enabled), max_parallel = COALESCE($6, max_parallel)
        WHERE id = $1`,
      [id, body.base_url ?? null, body.api_key_env !== undefined, body.api_key_env ?? null, body.enabled ?? null, body.max_parallel ?? null],
    );
    clearRegistryCache();
    await adminAudit(req, 'provider_updated', { id, ...body });
    return { ok: true };
  });

  // ── Settings ──
  app.get('/api/admin/settings', admin, async () => allSettings());

  app.patch('/api/admin/settings', admin, async (req) => {
    const body = z
      .object({
        retention_months: z.number().int().min(1).max(120).optional(),
        council_min_role: Role.optional(),
        peer_review_default: z.boolean().optional(),
        rag_enabled: z.boolean().optional(),
        rag_top_k: z.number().int().min(1).max(20).optional(),
        history_turns: z.number().int().min(0).max(20).optional(),
        clarify_enabled: z.boolean().optional(),
        weekly_digest_enabled: z.boolean().optional(),
        compliance_seat_departments: z.array(z.string().max(60)).max(20).optional(),
        portfolio_npl_days: z.number().int().min(30).max(360).optional(),
        portfolio_restructured_is_npl: z.boolean().optional(),
        portfolio_report_recipients: z.array(z.string().email()).max(20).optional(),
        affordability_max_deduction_pct: z.number().min(10).max(100).optional(),
        affordability_min_net: z.number().min(0).max(100000).optional(),
        notis_departments: z.array(z.string().max(60)).max(20).optional(),
        notis_hold_column: z.string().min(1).max(80).optional(),
        notis_retention_days: z.number().int().min(7).max(3650).optional(),
        merge_retention_days: z.number().int().min(7).max(3650).optional(),
        crew_names: z.object({ dispatcher: z.string(), herald: z.string(), tracker: z.string(), runner: z.string() }).optional(),
        crew_email_domains: z.array(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i)).min(1).optional(),
        crew_business_hours: z.object({ start: z.number().int().min(0).max(23), end: z.number().int().min(1).max(24) }).optional(),
        crew_weekend: z.array(z.number().int().min(0).max(6)).max(3).optional(),
        crew_timings: z
          .object({
            ackReminderDays: z.number().int().min(1).max(20),
            dueReminderDaysBefore: z.number().int().min(0).max(10),
            escalateAfterDays: z.number().int().min(1).max(30),
            escalationEnabled: z.boolean(),
          })
          .optional(),
      })
      .parse(req.body);
    for (const [k, v] of Object.entries(body)) if (v !== undefined) await setSetting(k, v);
    await adminAudit(req, 'settings_updated', body);
    return { ok: true };
  });

  // ── Audit log & usage ──
  app.get('/api/admin/audit', admin, async (req) => {
    const q = z
      .object({
        action: z.string().optional(),
        user: z.string().uuid().optional(),
        before: z.coerce.number().int().optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100),
      })
      .parse(req.query);
    const { rows } = await query(
      `SELECT a.id, a.at, a.action, a.target_type, a.target_id, a.detail, a.ip, a.actor_user_id, u.email AS actor_email
         FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id
        WHERE ($1::text IS NULL OR a.action = $1)
          AND ($2::uuid IS NULL OR a.actor_user_id = $2)
          AND ($3::bigint IS NULL OR a.id < $3)
        ORDER BY a.id DESC LIMIT $4`,
      [q.action ?? null, q.user ?? null, q.before ?? null, q.limit],
    );
    return rows;
  });

  app.get('/api/admin/stats', admin, async () => {
    const [byDept, modes, feedback, latency] = await Promise.all([
      query(
        `SELECT d.name, count(*)::int AS questions
           FROM messages m JOIN departments d ON d.id = m.department_id
          WHERE m.role = 'assistant' AND m.created_at > now() - interval '30 days'
          GROUP BY d.name ORDER BY questions DESC`,
      ),
      query(
        `SELECT COALESCE(mode, requested_mode) AS mode, count(*)::int AS n
           FROM messages WHERE role = 'assistant' AND created_at > now() - interval '30 days' GROUP BY 1`,
      ),
      query(
        `SELECT count(*) FILTER (WHERE rating = 1)::int AS up, count(*) FILTER (WHERE rating = -1)::int AS down
           FROM feedback WHERE created_at > now() - interval '30 days'`,
      ),
      query(
        `SELECT mode, round(avg(extract(epoch FROM completed_at - created_at)))::int AS avg_seconds,
                round(percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM completed_at - created_at)))::int AS p90_seconds
           FROM messages WHERE role = 'assistant' AND status = 'done' AND created_at > now() - interval '30 days'
          GROUP BY mode`,
      ),
    ]);
    return { byDepartment: byDept.rows, modes: modes.rows, feedback: feedback.rows[0], latency: latency.rows };
  });

  /**
   * Ask-the-org heatmap: which departments ask about which areas (the router's department), and
   * weekly volume per department. Counts only, no question content.
   */
  app.get('/api/admin/analytics/heatmap', admin, async (req) => {
    const { days } = z.object({ days: z.coerce.number().int().min(7).max(365).default(90) }).parse(req.query);
    const [cells, weekly] = await Promise.all([
      query(
        `SELECT COALESCE(ud.name, '(no department)') AS asker, COALESCE(ad.name, m.router->>'department') AS area,
                count(*)::int AS n, count(*) FILTER (WHERE m.mode = 'council')::int AS council,
                count(*) FILTER (WHERE (m.router->>'red_flag') IS NOT NULL AND m.router->>'red_flag' <> 'none')::int AS flags
           FROM messages m JOIN conversations c ON c.id = m.conversation_id JOIN users u ON u.id = c.user_id
           LEFT JOIN departments ud ON ud.id = u.department_id
           LEFT JOIN departments ad ON ad.slug = m.router->>'department'
          WHERE m.role = 'assistant' AND m.router IS NOT NULL AND m.created_at > now() - make_interval(days => $1)
          GROUP BY 1, 2`,
        [days],
      ),
      query(
        `SELECT to_char(date_trunc('week', m.created_at AT TIME ZONE 'Asia/Kuala_Lumpur'), 'YYYY-MM-DD') AS week,
                COALESCE(ud.name, '(no department)') AS asker, count(*)::int AS n
           FROM messages m JOIN conversations c ON c.id = m.conversation_id JOIN users u ON u.id = c.user_id
           LEFT JOIN departments ud ON ud.id = u.department_id
          WHERE m.role = 'assistant' AND m.created_at > now() - make_interval(days => $1)
          GROUP BY 1, 2 ORDER BY 1`,
        [days],
      ),
    ]);
    return { days, cells: cells.rows, weekly: weekly.rows };
  });

  /** Preview this week's digest for a department (what its head will receive on Monday). */
  app.get('/api/admin/digest/:departmentId', admin, async (req) => {
    const { departmentId } = z.object({ departmentId: z.string().uuid() }).parse(req.params);
    const data = await digestFor(departmentId);
    return { data, text: digestParagraphs('(department head)', data).join('\n\n') };
  });

  app.post('/api/admin/digest/send-now', admin, async (req) => {
    const n = await weeklyDigests();
    await writeAudit({ actorUserId: req.user.id, action: 'weekly_digest_manual', detail: { recipients: n } });
    return { queued: n };
  });
}
