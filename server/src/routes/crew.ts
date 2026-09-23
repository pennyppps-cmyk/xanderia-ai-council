import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { writeAudit } from '../audit.js';
import { config } from '../config.js';
import {
  applyTaskAction,
  createPlan,
  CrewError,
  crewStatus,
  decideEscalation,
  followUp,
  launchPlan,
  type TaskAction,
} from '../crew/service.js';
import { verifyTaskToken } from '../crew/tokens.js';
import { parseCsv } from '../crew/csv.js';
import { query, tx } from '../db/pool.js';
import { enqueueDispatch, enqueueRunner } from '../queue/crewQueue.js';

const Uuid = z.object({ id: z.string().uuid() });

function crewErrors(reply: FastifyReply, err: unknown) {
  if (err instanceof CrewError) return reply.code(err.status).send({ error: err.message });
  throw err;
}

async function planForUser(planId: string, userId: string) {
  const { rows } = await query(`SELECT * FROM action_plans WHERE id = $1 AND requester_id = $2`, [planId, userId]);
  return rows[0] ?? null;
}

const TASK_COLUMNS = `t.id, t.plan_id, t.seq, t.title, t.description, t.owner_type, t.owner_role, t.directory_id,
  t.resolution, t.candidates, t.depends_on, to_char(t.due_date, 'YYYY-MM-DD') AS due_date, t.status, t.email_subject,
  t.email_body, t.approved, t.response_note, t.agent_output, t.sent_at, t.acknowledged_at, t.completed_at,
  t.escalation_state, t.snoozed_until, t.updated_at,
  s.name AS owner_name, s.position AS owner_position, s.email AS owner_email, s.manager_email`;

export default async function crewRoutes(app: FastifyInstance) {
  const auth = { preHandler: app.authenticate };
  const admin = { preHandler: app.requireRole('admin') };

  // ── Plans ──
  app.post('/api/messages/:id/plan', auth, async (req, reply) => {
    const { id } = Uuid.parse(req.params);
    try {
      const plan = await createPlan(id, req.user.id);
      if (plan.created) await enqueueDispatch(plan.id);
      return plan;
    } catch (err) {
      return crewErrors(reply, err);
    }
  });

  const progressSql = `SELECT p.id, p.message_id, p.conversation_id, p.title, p.status, p.error, p.created_at, p.launched_at,
       count(t.id)::int AS total,
       count(t.id) FILTER (WHERE t.status = 'done')::int AS done,
       count(t.id) FILTER (WHERE t.status IN ('sent','accepted','in_progress','blocked') AND t.due_date < current_date)::int AS overdue
     FROM action_plans p LEFT JOIN action_tasks t ON t.plan_id = p.id AND t.status <> 'cancelled'`;

  app.get('/api/messages/:id/plan', auth, async (req, reply) => {
    const { id } = Uuid.parse(req.params);
    const { rows } = await query(`${progressSql} WHERE p.message_id = $1 AND p.requester_id = $2 GROUP BY p.id`, [id, req.user.id]);
    if (!rows[0]) return reply.code(404).send({ error: 'No plan' });
    return rows[0];
  });

  app.get('/api/plans', auth, async (req) => {
    const { rows } = await query(`${progressSql} WHERE p.requester_id = $1 GROUP BY p.id ORDER BY p.created_at DESC LIMIT 100`, [req.user.id]);
    return rows;
  });

  app.get('/api/plans/:id', auth, async (req, reply) => {
    const { id } = Uuid.parse(req.params);
    const plan = await planForUser(id, req.user.id);
    if (!plan) return reply.code(404).send({ error: 'Not found' });
    const { rows: tasks } = await query(
      `SELECT ${TASK_COLUMNS},
              (SELECT json_agg(json_build_object('kind', e.kind, 'status', e.status, 'to', e.to_email, 'send_after', e.send_after, 'sent_at', e.sent_at) ORDER BY e.created_at)
                 FROM outbound_emails e WHERE e.task_id = t.id) AS emails,
              (SELECT json_agg(json_build_object('kind', ev.kind, 'at', ev.at, 'actor', ev.actor, 'detail', ev.detail) ORDER BY ev.at)
                 FROM task_events ev WHERE ev.task_id = t.id) AS events
         FROM action_tasks t LEFT JOIN staff_directory s ON s.id = t.directory_id
        WHERE t.plan_id = $1 ORDER BY t.seq`,
      [id],
    );
    return { plan, tasks };
  });

  app.post('/api/plans/:id/launch', auth, async (req, reply) => {
    const { id } = Uuid.parse(req.params);
    const body = z
      .object({
        tasks: z.array(
          z.object({
            id: z.string().uuid(),
            approved: z.boolean(),
            directory_id: z.string().uuid().nullable().optional(),
            due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
            email_body: z.string().max(3000).optional(),
            owner_type: z.enum(['human', 'agent']).optional(),
          }),
        ),
      })
      .parse(req.body);
    try {
      const result = await launchPlan(id, req.user.id, body.tasks);
      for (const taskId of result.agentTasks) await enqueueRunner(taskId);
      return result;
    } catch (err) {
      return crewErrors(reply, err);
    }
  });

  app.post('/api/plans/:id/cancel', auth, async (req, reply) => {
    const { id } = Uuid.parse(req.params);
    const plan = await planForUser(id, req.user.id);
    if (!plan) return reply.code(404).send({ error: 'Not found' });
    await tx(async (c) => {
      await c.query(`UPDATE action_plans SET status = 'cancelled' WHERE id = $1`, [id]);
      await c.query(`UPDATE action_tasks SET status = 'cancelled' WHERE plan_id = $1 AND status NOT IN ('done')`, [id]);
      await c.query(
        `UPDATE outbound_emails SET status = 'blocked', error = 'Plan cancelled'
          WHERE status = 'queued' AND task_id IN (SELECT id FROM action_tasks WHERE plan_id = $1)`,
        [id],
      );
    });
    await writeAudit({ actorUserId: req.user.id, action: 'action_plan_cancelled', targetType: 'action_plan', targetId: id, detail: {} });
    return { ok: true };
  });

  // ── Tasks ──
  app.post('/api/tasks/:id/action', auth, async (req, reply) => {
    const { id } = Uuid.parse(req.params);
    const body = z
      .object({ action: z.enum(['accept', 'start', 'help', 'done', 'cant', 'cancel', 'approve_draft']), note: z.string().max(1000).optional() })
      .parse(req.body);
    const { rows } = await query(
      `SELECT p.requester_id, lower(s.email) AS owner_email FROM action_tasks t
         JOIN action_plans p ON p.id = t.plan_id LEFT JOIN staff_directory s ON s.id = t.directory_id WHERE t.id = $1`,
      [id],
    );
    const t = rows[0];
    if (!t) return reply.code(404).send({ error: 'Not found' });
    const isRequester = t.requester_id === req.user.id;
    const isOwner = t.owner_email && t.owner_email === req.user.email.toLowerCase();
    const requesterOnly: TaskAction[] = ['cancel', 'approve_draft'];
    if (!(isRequester || (isOwner && !requesterOnly.includes(body.action)))) return reply.code(403).send({ error: 'Forbidden' });
    try {
      return await applyTaskAction(id, body.action, `user:${req.user.id}`, body.note);
    } catch (err) {
      return crewErrors(reply, err);
    }
  });

  /** Requester reassigns a task (before or after launch). A launched task goes back to draft for re-approval. */
  app.patch('/api/tasks/:id', auth, async (req, reply) => {
    const { id } = Uuid.parse(req.params);
    const body = z.object({ directory_id: z.string().uuid() }).parse(req.body);
    const { rows } = await query(
      `SELECT t.id FROM action_tasks t JOIN action_plans p ON p.id = t.plan_id WHERE t.id = $1 AND p.requester_id = $2`,
      [id, req.user.id],
    );
    if (!rows[0]) return reply.code(404).send({ error: 'Not found' });
    const dir = await query(`SELECT id FROM staff_directory WHERE id = $1 AND is_active`, [body.directory_id]);
    if (!dir.rows[0]) return reply.code(400).send({ error: 'Owner must be chosen from the staff directory' });
    await query(
      `UPDATE action_tasks SET directory_id = $2, resolution = 'resolved', owner_type = 'human', status = 'draft', approved = false,
              sent_at = NULL, acknowledged_at = NULL, ack_reminded_at = NULL, due_reminded_at = NULL, nudged_at = NULL,
              escalation_state = 'none', updated_at = now()
        WHERE id = $1`,
      [id, body.directory_id],
    );
    await query(`INSERT INTO task_events (task_id, kind, actor) VALUES ($1, 'reassigned', $2)`, [id, `user:${req.user.id}`]);
    return { ok: true };
  });

  app.post('/api/tasks/:id/escalation', auth, async (req, reply) => {
    const { id } = Uuid.parse(req.params);
    const { approve } = z.object({ approve: z.boolean() }).parse(req.body);
    try {
      await decideEscalation(id, req.user.id, approve);
      return { ok: true };
    } catch (err) {
      return crewErrors(reply, err);
    }
  });

  app.post('/api/tasks/:id/follow-up', auth, async (req, reply) => {
    const { id } = Uuid.parse(req.params);
    const { kind } = z.object({ kind: z.enum(['remind', 'snooze']) }).parse(req.body);
    try {
      await followUp(id, req.user.id, kind);
      return { ok: true };
    } catch (err) {
      return crewErrors(reply, err);
    }
  });

  /** Tasks assigned to me (my email is in the staff directory). */
  app.get('/api/tasks/mine', auth, async (req) => {
    const { rows } = await query(
      `SELECT ${TASK_COLUMNS}, p.title AS plan_title, u.display_name AS requester_name
         FROM action_tasks t JOIN staff_directory s ON s.id = t.directory_id
         JOIN action_plans p ON p.id = t.plan_id JOIN users u ON u.id = p.requester_id
        WHERE lower(s.email) = lower($1) AND t.status NOT IN ('draft', 'cancelled')
        ORDER BY (t.status = 'done'), t.due_date NULLS LAST`,
      [req.user.email],
    );
    return rows;
  });

  app.get('/api/crew/status', auth, async (req) => crewStatus(req.user.id));

  app.get('/api/directory/search', auth, async (req) => {
    const { q } = z.object({ q: z.string().trim().max(100).default('') }).parse(req.query);
    const { rows } = await query(
      `SELECT s.id, s.name, s.position, s.email, d.name AS department
         FROM staff_directory s LEFT JOIN departments d ON d.id = s.department_id
        WHERE s.is_active AND ($1 = '' OR s.name ILIKE $2 OR s.position ILIKE $2 OR d.name ILIKE $2)
        ORDER BY s.name LIMIT 30`,
      [q, `%${q}%`],
    );
    return rows;
  });

  // ── Notifications ──
  app.get('/api/notifications', auth, async (req) => {
    const { rows } = await query(
      `SELECT id, kind, title, body, link, task_id, read_at, created_at FROM notifications
        WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.user.id],
    );
    return rows;
  });

  app.post('/api/notifications/read', auth, async (req) => {
    const { ids } = z.object({ ids: z.array(z.string().uuid()).optional() }).parse(req.body ?? {});
    await query(
      `UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))`,
      [req.user.id, ids ?? null],
    );
    return { ok: true };
  });

  // ── Public one-click links from task emails (no login; signed, expiring token) ──
  const ACTIONS: Record<string, { label: string; action: TaskAction; askNote: boolean }> = {
    accept: { label: 'Accept this task', action: 'accept', askNote: false },
    done: { label: 'Mark this task as done', action: 'done', askNote: false },
    help: { label: 'Ask for help', action: 'help', askNote: true },
    cant: { label: "Tell the requester you can't do it", action: 'cant', askNote: true },
  };

  // A confirm page (not a GET that changes state), so email link scanners cannot click on the owner's behalf.
  app.get('/api/t/:token', async (req, reply) => {
    const { token } = z.object({ token: z.string().max(400) }).parse(req.params);
    const { a } = z.object({ a: z.string().optional() }).parse(req.query);
    const v = verifyTaskToken(token, config.JWT_SECRET);
    const act = ACTIONS[a ?? ''] ?? ACTIONS.accept;
    if (!v) return page(reply, 'Link expired', 'This link is no longer valid. Please open the Xanderia AI Council app instead.');
    const { rows } = await query(
      `SELECT t.title, t.description, t.status, to_char(t.due_date, 'DD Mon YYYY') AS due, u.display_name AS requester
         FROM action_tasks t JOIN action_plans p ON p.id = t.plan_id JOIN users u ON u.id = p.requester_id WHERE t.id = $1`,
      [v.taskId],
    );
    const t = rows[0];
    if (!t) return page(reply, 'Task not found', 'This task no longer exists.');
    return page(
      reply,
      act.label,
      `<p><strong>${esc(t.title)}</strong></p><p>${esc(t.description)}</p><p class="muted">Due ${esc(t.due ?? 'not set')} · requested by ${esc(t.requester)} · current status: ${esc(t.status.replace('_', ' '))}</p>
       <form method="post">
         <input type="hidden" name="a" value="${esc(a ?? 'accept')}">
         ${act.askNote ? '<label>What do you need, or why not? (sent to the requester)<textarea name="note" rows="4" required></textarea></label>' : ''}
         <button type="submit">${esc(act.label)}</button>
       </form>`,
    );
  });

  app.post('/api/t/:token', async (req, reply) => {
    const { token } = z.object({ token: z.string().max(400) }).parse(req.params);
    const body = z.object({ a: z.string(), note: z.string().max(1000).optional() }).parse(req.body);
    const v = verifyTaskToken(token, config.JWT_SECRET);
    const act = ACTIONS[body.a];
    if (!v || !act) return page(reply, 'Link expired', 'This link is no longer valid.');
    const r = await applyTaskAction(v.taskId, act.action, 'email-link', body.note);
    return page(
      reply,
      r.changed ? 'Thank you' : 'No change needed',
      r.changed
        ? `<p>The task is now <strong>${esc(r.status.replace('_', ' '))}</strong>. The requester has been notified.</p>`
        : `<p>This task is already <strong>${esc(r.status.replace('_', ' '))}</strong>, so nothing changed.</p>`,
    );
  });

  // ── Admin: staff directory, holidays, outbox ──
  app.get('/api/admin/directory', admin, async () => {
    const { rows } = await query(
      `SELECT s.*, d.name AS department_name FROM staff_directory s LEFT JOIN departments d ON d.id = s.department_id ORDER BY s.name`,
    );
    return rows;
  });

  const Person = z.object({
    name: z.string().trim().min(1),
    position: z.string().trim().min(1),
    email: z.string().trim().email(),
    department_id: z.string().uuid().nullable().optional(),
    manager_email: z.string().trim().email().nullable().optional().or(z.literal('')),
    is_active: z.boolean().optional(),
  });

  app.post('/api/admin/directory', admin, async (req, reply) => {
    const p = Person.parse(req.body);
    try {
      const { rows } = await query(
        `INSERT INTO staff_directory (name, position, email, department_id, manager_email) VALUES ($1, $2, lower($3), $4, lower(NULLIF($5, ''))) RETURNING id`,
        [p.name, p.position, p.email, p.department_id ?? null, p.manager_email ?? null],
      );
      await writeAudit({ actorUserId: req.user.id, action: 'directory_added', targetId: rows[0].id, detail: { email: p.email } });
      return rows[0];
    } catch (err: any) {
      if (err.code === '23505') return reply.code(409).send({ error: 'That email is already in the directory' });
      throw err;
    }
  });

  app.patch('/api/admin/directory/:id', admin, async (req) => {
    const { id } = Uuid.parse(req.params);
    const p = Person.partial().parse(req.body);
    await query(
      `UPDATE staff_directory SET name = COALESCE($2, name), position = COALESCE($3, position), email = COALESCE(lower($4), email),
              department_id = CASE WHEN $5::boolean THEN $6::uuid ELSE department_id END,
              manager_email = CASE WHEN $7::boolean THEN lower(NULLIF($8, '')) ELSE manager_email END,
              is_active = COALESCE($9, is_active), updated_at = now()
        WHERE id = $1`,
      [id, p.name ?? null, p.position ?? null, p.email ?? null, p.department_id !== undefined, p.department_id ?? null, p.manager_email !== undefined, p.manager_email ?? null, p.is_active ?? null],
    );
    await writeAudit({ actorUserId: req.user.id, action: 'directory_updated', targetId: id, detail: p });
    return { ok: true };
  });

  /** CSV import (HR export). Columns: name, position, department, email, manager_email. Upserts by email. */
  app.post('/api/admin/directory/import', admin, async (req, reply) => {
    const { csv } = z.object({ csv: z.string().min(1).max(2_000_000) }).parse(req.body);
    const rows = parseCsv(csv);
    if (rows.length < 2) return reply.code(400).send({ error: 'The CSV needs a header row and at least one person' });
    const header = rows[0].map((h) => h.trim().toLowerCase().replace(/[^a-z]/g, ''));
    const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
    const ci = {
      name: col('name', 'fullname', 'staffname'),
      position: col('position', 'title', 'jobtitle', 'designation', 'jawatan'),
      department: col('department', 'dept', 'jabatan'),
      email: col('email', 'emailaddress', 'workemail'),
      manager: col('manageremail', 'manager', 'reportsto', 'supervisoremail'),
    };
    if (ci.name < 0 || ci.position < 0 || ci.email < 0) {
      return reply.code(400).send({ error: 'The CSV needs at least name, position and email columns' });
    }
    const { rows: depts } = await query(`SELECT id, slug, lower(name) AS name FROM departments`);
    const deptId = (v: string) => {
      const k = v.trim().toLowerCase();
      return depts.find((d) => d.name === k || d.slug === k)?.id ?? null;
    };
    let imported = 0;
    const skipped: string[] = [];
    await tx(async (c) => {
      for (const r of rows.slice(1)) {
        const email = (r[ci.email] ?? '').trim().toLowerCase();
        const name = (r[ci.name] ?? '').trim();
        const position = (r[ci.position] ?? '').trim();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !name || !position) {
          if (r.some((x) => x.trim())) skipped.push(email || name || '(blank)');
          continue;
        }
        const manager = ci.manager >= 0 ? (r[ci.manager] ?? '').trim().toLowerCase() : '';
        await c.query(
          `INSERT INTO staff_directory (name, position, email, department_id, manager_email)
           VALUES ($1, $2, $3, $4, NULLIF($5, ''))
           ON CONFLICT (lower(email)) DO UPDATE SET name = EXCLUDED.name, position = EXCLUDED.position,
             department_id = EXCLUDED.department_id, manager_email = EXCLUDED.manager_email, is_active = true, updated_at = now()`,
          [name, position, email, ci.department >= 0 ? deptId(r[ci.department] ?? '') : null, manager],
        );
        imported++;
      }
    });
    await writeAudit({ actorUserId: req.user.id, action: 'directory_imported', detail: { imported, skipped: skipped.length } });
    return { imported, skipped };
  });

  app.get('/api/admin/holidays', admin, async () => {
    const { rows } = await query(`SELECT to_char(date, 'YYYY-MM-DD') AS date, name FROM holidays ORDER BY date`);
    return rows;
  });

  app.post('/api/admin/holidays', admin, async (req) => {
    const h = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), name: z.string().trim().min(1) }).parse(req.body);
    await query(`INSERT INTO holidays (date, name) VALUES ($1, $2) ON CONFLICT (date) DO UPDATE SET name = EXCLUDED.name`, [h.date, h.name]);
    return { ok: true };
  });

  app.delete('/api/admin/holidays/:date', admin, async (req) => {
    const { date } = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.params);
    await query(`DELETE FROM holidays WHERE date = $1`, [date]);
    return { ok: true };
  });

  app.get('/api/admin/outbox', admin, async () => {
    const { rows } = await query(
      `SELECT e.id, e.kind, e.to_email, e.subject, e.body_text, e.status, e.provider, e.error, e.send_after, e.created_at, e.sent_at
         FROM outbound_emails e ORDER BY e.created_at DESC LIMIT 200`,
    );
    return { provider: config.MAIL_PROVIDER, emails: rows };
  });
}

function esc(s: string) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function page(reply: FastifyReply, title: string, body: string) {
  return reply
    .header('content-type', 'text/html; charset=utf-8')
    .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'")
    .header('cache-control', 'no-store')
    .send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Xanderia AI Council</title>
<style>body{margin:0;background:#f3f6f8;font-family:Segoe UI,Arial,sans-serif;color:#17354a}
.card{max-width:520px;margin:40px auto;background:#fff;border:1px solid #e3eaef;border-radius:14px;overflow:hidden}
.top{background:#0f2a3d;color:#cdf6ee;padding:14px 20px;font-weight:600;font-size:14px}.in{padding:20px}
h1{font-size:18px;margin:0 0 12px}.muted{color:#7890a3;font-size:13px}label{display:block;font-size:13px;margin:12px 0}
textarea{width:100%;box-sizing:border-box;margin-top:6px;border:1px solid #c7d4de;border-radius:8px;padding:8px;font:inherit}
button{background:#0f2a3d;color:#fff;border:0;border-radius:8px;padding:10px 16px;font-weight:600;font-size:14px;cursor:pointer}</style>
</head><body><div class="card"><div class="top">Xanderia AI Council</div><div class="in"><h1>${esc(title)}</h1>${body}</div></div></body></html>`);
}
