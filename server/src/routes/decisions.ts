import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { writeAudit } from '../audit.js';
import { verdictToMarkdown } from '../council/format.js';
import { query } from '../db/pool.js';
import { PRIORITY } from '../llm/gate.js';
import { gateway } from '../llm/registry.js';
import type { Verdict } from '../llm/schemas.js';
import { assemblePrompt } from '../prompts/assembler.js';

/**
 * Decision register (who decided what, and did it work?).
 * Visibility: your own decisions, your department's, company-wide ones; admins and the
 * Management department see everything.
 */
function visibleClause(req: FastifyRequest, alias = 'd') {
  return {
    sql: `($1::boolean OR ${alias}.recorded_by = $2 OR ${alias}.visibility = 'company' OR ${alias}.department_id = $3)`,
    params: [false, req.user.id, req.user.department_id] as unknown[],
  };
}

async function seesEverything(req: FastifyRequest) {
  if (req.user.role === 'admin') return true;
  const { rows } = await query(`SELECT slug FROM departments WHERE id = $1`, [req.user.department_id]);
  return rows[0]?.slug === 'management';
}

async function canEdit(req: FastifyRequest, decisionId: string) {
  const { rows } = await query(`SELECT recorded_by, department_id FROM decisions WHERE id = $1`, [decisionId]);
  const d = rows[0];
  if (!d) return null;
  return d.recorded_by === req.user.id || req.user.role === 'admin' || (req.user.role === 'dept_lead' && d.department_id === req.user.department_id);
}

const LIST_SQL = (where: string) => `
  SELECT d.id, d.message_id, d.title, d.summary, d.visibility, d.status, d.decided_at, d.next_check_in,
         dep.name AS department_name, u.display_name AS recorded_by_name, d.recorded_by,
         (SELECT row_to_json(o) FROM (SELECT rating, note, created_at FROM decision_outcomes WHERE decision_id = d.id ORDER BY created_at DESC LIMIT 1) o) AS latest_outcome,
         (SELECT json_build_object('id', p.id, 'status', p.status,
                 'total', (SELECT count(*) FROM action_tasks t WHERE t.plan_id = p.id AND t.status <> 'cancelled'),
                 'done', (SELECT count(*) FROM action_tasks t WHERE t.plan_id = p.id AND t.status = 'done'))
            FROM action_plans p WHERE p.message_id = d.message_id) AS plan
    FROM decisions d
    LEFT JOIN departments dep ON dep.id = d.department_id
    JOIN users u ON u.id = d.recorded_by
   WHERE ${where}`;

export default async function decisionRoutes(app: FastifyInstance) {
  const auth = { preHandler: app.authenticate };

  app.post('/api/messages/:id/decision', auth, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({ title: z.string().trim().min(3).max(200).optional(), visibility: z.enum(['department', 'company']).default('department') })
      .parse(req.body ?? {});
    const { rows } = await query(
      `SELECT m.id, m.verdict, m.department_id FROM messages m JOIN conversations c ON c.id = m.conversation_id
        WHERE m.id = $1 AND c.user_id = $2 AND m.mode = 'council' AND m.status = 'done' AND m.verdict IS NOT NULL`,
      [id, req.user.id],
    );
    const m = rows[0];
    if (!m) return reply.code(404).send({ error: 'Only your own finished council verdicts can be recorded' });
    const v = m.verdict as Verdict;
    const { rows: ins } = await query(
      `INSERT INTO decisions (message_id, recorded_by, department_id, title, summary, visibility, next_check_in)
       VALUES ($1, $2, $3, $4, $5, $6, current_date + 30)
       ON CONFLICT (message_id) DO UPDATE SET title = EXCLUDED.title, visibility = EXCLUDED.visibility
       RETURNING id`,
      [id, req.user.id, m.department_id, body.title ?? v.verdict.slice(0, 200), v.verdict, body.visibility],
    );
    await writeAudit({ actorUserId: req.user.id, action: 'decision_recorded', targetType: 'decision', targetId: ins[0].id, detail: { message_id: id, visibility: body.visibility } });
    return ins[0];
  });

  app.get('/api/messages/:id/decision', auth, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { rows } = await query(`SELECT id, status, visibility FROM decisions WHERE message_id = $1 AND recorded_by = $2`, [id, req.user.id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Not recorded' });
    return rows[0];
  });

  app.get('/api/decisions', auth, async (req) => {
    const q = z
      .object({ q: z.string().trim().max(100).optional(), status: z.string().optional(), department: z.string().uuid().optional() })
      .parse(req.query);
    const vis = visibleClause(req);
    vis.params[0] = await seesEverything(req);
    const params = [...vis.params, q.q ? `%${q.q}%` : null, q.status ?? null, q.department ?? null];
    const { rows } = await query(
      `${LIST_SQL(`${vis.sql} AND ($4::text IS NULL OR d.title ILIKE $4 OR d.summary ILIKE $4)
                   AND ($5::text IS NULL OR d.status = $5) AND ($6::uuid IS NULL OR d.department_id = $6)`)}
       ORDER BY d.decided_at DESC LIMIT 200`,
      params,
    );
    return rows;
  });

  app.get('/api/decisions/:id', auth, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const vis = visibleClause(req);
    vis.params[0] = await seesEverything(req);
    const { rows } = await query(`${LIST_SQL(`d.id = $4 AND ${vis.sql}`)}`, [...vis.params, id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Not found' });
    const { rows: verdict } = await query(`SELECT verdict FROM messages WHERE id = $1`, [rows[0].message_id]);
    const { rows: outcomes } = await query(
      `SELECT o.rating, o.note, o.created_at, u.display_name AS by FROM decision_outcomes o LEFT JOIN users u ON u.id = o.recorded_by
        WHERE o.decision_id = $1 ORDER BY o.created_at DESC`,
      [id],
    );
    return { ...rows[0], verdict: verdict[0]?.verdict ?? null, outcomes, can_edit: Boolean(await canEdit(req, id)) };
  });

  app.patch('/api/decisions/:id', auth, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        title: z.string().trim().min(3).max(200).optional(),
        status: z.enum(['decided', 'in_progress', 'done', 'dropped']).optional(),
        visibility: z.enum(['department', 'company']).optional(),
      })
      .parse(req.body);
    if (!(await canEdit(req, id))) return reply.code(403).send({ error: 'Forbidden' });
    await query(
      `UPDATE decisions SET title = COALESCE($2, title), status = COALESCE($3, status), visibility = COALESCE($4, visibility),
              next_check_in = CASE WHEN $3 = 'dropped' THEN NULL ELSE next_check_in END
        WHERE id = $1`,
      [id, body.title ?? null, body.status ?? null, body.visibility ?? null],
    );
    await writeAudit({ actorUserId: req.user.id, action: 'decision_updated', targetType: 'decision', targetId: id, detail: body });
    return { ok: true };
  });

  app.post('/api/decisions/:id/outcomes', auth, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ rating: z.enum(['worked', 'partly', 'did_not_work', 'too_early']), note: z.string().max(2000).optional() }).parse(req.body);
    if (!(await canEdit(req, id))) return reply.code(403).send({ error: 'Forbidden' });
    await query(`INSERT INTO decision_outcomes (decision_id, rating, note, recorded_by) VALUES ($1, $2, $3, $4)`, [id, body.rating, body.note ?? null, req.user.id]);
    if (body.rating !== 'too_early') await query(`UPDATE decisions SET status = CASE WHEN status = 'dropped' THEN status ELSE 'done' END WHERE id = $1`, [id]);
    await writeAudit({ actorUserId: req.user.id, action: 'decision_outcome', targetType: 'decision', targetId: id, detail: { rating: body.rating } });
    return { ok: true };
  });

  /** One-page meeting brief of the decisions in a date range (the reader's visibility applies). */
  app.post('/api/decisions/brief', auth, async (req) => {
    const body = z
      .object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), department: z.string().uuid().optional() })
      .parse(req.body);
    const vis = visibleClause(req);
    vis.params[0] = await seesEverything(req);
    const { rows } = await query(
      `${LIST_SQL(`${vis.sql} AND d.decided_at::date BETWEEN $4::date AND $5::date AND ($6::uuid IS NULL OR d.department_id = $6)`)} ORDER BY d.decided_at`,
      [...vis.params, body.from, body.to, body.department ?? null],
    );
    if (!rows.length) return { markdown: `No decisions were recorded between ${body.from} and ${body.to}.`, count: 0 };
    const items = [];
    for (const d of rows) {
      const { rows: v } = await query(`SELECT verdict FROM messages WHERE id = $1`, [d.message_id]);
      items.push(
        `### ${d.title}\nDepartment: ${d.department_name ?? '-'} · decided ${new Date(d.decided_at).toISOString().slice(0, 10)} by ${d.recorded_by_name} · status: ${d.status}` +
          (d.plan ? ` · action plan ${d.plan.done}/${d.plan.total} done` : '') +
          (d.latest_outcome ? ` · latest outcome: ${d.latest_outcome.rating}${d.latest_outcome.note ? ` (${d.latest_outcome.note})` : ''}` : '') +
          `\n${v[0]?.verdict ? verdictToMarkdown(v[0].verdict).slice(0, 1500) : d.summary}`,
      );
    }
    const system = await assemblePrompt({ task: 'meeting_brief' });
    const out = await gateway.call(
      'document',
      [
        { role: 'system', content: system },
        { role: 'user', content: `Period: ${body.from} to ${body.to}. Decisions (data):\n\n${items.join('\n\n')}` },
      ],
      { userId: req.user.id, sensitivity: 'high', priority: PRIORITY.quick, purpose: 'meeting_brief' },
    );
    await writeAudit({ actorUserId: req.user.id, action: 'meeting_brief', detail: { from: body.from, to: body.to, decisions: rows.length } });
    return { markdown: out.content.trim(), count: rows.length };
  });
}
