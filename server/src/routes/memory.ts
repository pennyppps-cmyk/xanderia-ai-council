import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { writeAudit } from '../audit.js';
import { pool, query } from '../db/pool.js';
import { embed } from '../llm/registry.js';
import { indexApprovedAnswer } from '../memory/memory.js';
import { improvementReport } from '../memory/report.js';

/**
 * Company memory: approved answers (staff suggest, leads approve) and house rules (leads write).
 * Department leads manage their own department; admins manage everything, including company-wide items.
 */
const isAdmin = (req: FastifyRequest) => req.user.role === 'admin';
const isLead = (req: FastifyRequest) => req.user.role === 'dept_lead' || req.user.role === 'admin';
/** Leads act on their own department only; company-wide (NULL) items are admin-only. */
const canManage = (req: FastifyRequest, departmentId: string | null) => isAdmin(req) || (req.user.role === 'dept_lead' && departmentId === req.user.department_id);
const embedFor = (userId: string) => (texts: string[]) => embed(texts, { userId, purpose: 'memory' });

export default async function memoryRoutes(app: FastifyInstance) {
  const auth = { preHandler: app.authenticate };

  // ── Approved answers ──
  /** Save an answer as a company answer: a suggestion for staff, approved straight away for leads. */
  app.post('/api/messages/:id/company-answer', auth, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ note: z.string().trim().max(500).optional() }).parse(req.body ?? {});
    const { rows } = await query(
      `SELECT m.id, m.content, m.department_id, COALESCE(m.options->>'effectiveQuestion', q.content) AS question
         FROM messages m JOIN messages q ON q.id = m.reply_to JOIN conversations c ON c.id = m.conversation_id
        WHERE m.id = $1 AND c.user_id = $2 AND m.role = 'assistant' AND m.status = 'done' AND m.mode IN ('quick', 'council')`,
      [id, req.user.id],
    );
    const m = rows[0];
    if (!m?.content) return reply.code(404).send({ error: 'Only your own finished answers can be saved' });
    const approveNow = canManage(req, m.department_id);
    const { rows: ins } = await query(
      `INSERT INTO approved_answers (source_message_id, department_id, question, answer, status, suggested_by, note,
                                     reviewed_by, reviewed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (source_message_id) DO UPDATE SET note = COALESCE(EXCLUDED.note, approved_answers.note)
       RETURNING id, status`,
      [id, m.department_id, m.question.slice(0, 4000), m.content.slice(0, 12000), approveNow ? 'approved' : 'suggested', req.user.id, body.note ?? null,
        approveNow ? req.user.id : null, approveNow ? new Date() : null],
    );
    if (ins[0].status === 'approved') await indexApprovedAnswer(pool, embedFor(req.user.id), ins[0].id).catch(() => {});
    await writeAudit({ actorUserId: req.user.id, action: approveNow ? 'company_answer_approved' : 'company_answer_suggested', targetType: 'approved_answer', targetId: ins[0].id, detail: { message_id: id } });
    return ins[0];
  });

  app.get('/api/messages/:id/company-answer', auth, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { rows } = await query(
      `SELECT a.id, a.status FROM approved_answers a JOIN messages m ON m.id = a.source_message_id
         JOIN conversations c ON c.id = m.conversation_id WHERE a.source_message_id = $1 AND c.user_id = $2`,
      [id, req.user.id],
    );
    if (!rows[0]) return reply.code(404).send({ error: 'Not saved' });
    return rows[0];
  });

  app.get('/api/memory/answers', auth, async (req, reply) => {
    if (!isLead(req)) return reply.code(403).send({ error: 'Forbidden' });
    const { status } = z.object({ status: z.enum(['suggested', 'approved', 'rejected']).optional() }).parse(req.query);
    const { rows } = await query(
      `SELECT a.id, a.question, a.answer, a.status, a.note, a.department_id, dep.name AS department_name,
              su.display_name AS suggested_by, rv.display_name AS reviewed_by, a.created_at, a.reviewed_at
         FROM approved_answers a LEFT JOIN departments dep ON dep.id = a.department_id
         LEFT JOIN users su ON su.id = a.suggested_by LEFT JOIN users rv ON rv.id = a.reviewed_by
        WHERE ($1::text IS NULL OR a.status = $1) AND ($2::boolean OR a.department_id = $3)
        ORDER BY a.created_at DESC LIMIT 300`,
      [status ?? null, isAdmin(req), req.user.department_id],
    );
    return rows;
  });

  /** Approve (optionally editing the text or making it company-wide), reject, or retire an answer. */
  app.patch('/api/memory/answers/:id', auth, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        status: z.enum(['approved', 'rejected', 'suggested']).optional(),
        question: z.string().trim().min(5).max(4000).optional(),
        answer: z.string().trim().min(5).max(12000).optional(),
        companyWide: z.boolean().optional(),
      })
      .parse(req.body);
    const { rows } = await query(`SELECT department_id FROM approved_answers WHERE id = $1`, [id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Not found' });
    if (!canManage(req, rows[0].department_id)) return reply.code(403).send({ error: 'Forbidden' });
    if (body.companyWide && !isAdmin(req)) return reply.code(403).send({ error: 'Only admins can make an answer company-wide' });
    await query(
      `UPDATE approved_answers SET status = COALESCE($2, status), question = COALESCE($3, question), answer = COALESCE($4, answer),
              department_id = CASE WHEN $5::boolean THEN NULL ELSE department_id END,
              reviewed_by = $6, reviewed_at = now(), updated_at = now()
        WHERE id = $1`,
      [id, body.status ?? null, body.question ?? null, body.answer ?? null, body.companyWide ?? false, req.user.id],
    );
    const { rows: after } = await query(`SELECT status FROM approved_answers WHERE id = $1`, [id]);
    if (after[0].status === 'approved' && (body.status === 'approved' || body.question)) {
      try {
        await indexApprovedAnswer(pool, embedFor(req.user.id), id);
      } catch (err) {
        return reply.code(502).send({ error: `Saved, but it could not be indexed yet: ${(err as Error).message}` });
      }
    }
    await writeAudit({ actorUserId: req.user.id, action: 'company_answer_reviewed', targetType: 'approved_answer', targetId: id, detail: { status: after[0].status, edited: Boolean(body.answer || body.question) } });
    return { ok: true, status: after[0].status };
  });

  app.delete('/api/memory/answers/:id', auth, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { rows } = await query(`SELECT department_id FROM approved_answers WHERE id = $1`, [id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Not found' });
    if (!canManage(req, rows[0].department_id)) return reply.code(403).send({ error: 'Forbidden' });
    await query(`DELETE FROM approved_answers WHERE id = $1`, [id]);
    await writeAudit({ actorUserId: req.user.id, action: 'company_answer_deleted', targetType: 'approved_answer', targetId: id, detail: {} });
    return { ok: true };
  });

  // ── House rules ──
  app.get('/api/memory/rules', auth, async (req, reply) => {
    if (!isLead(req)) return reply.code(403).send({ error: 'Forbidden' });
    const { rows } = await query(
      `SELECT r.id, r.text, r.department_id, dep.name AS department_name, r.is_active, u.display_name AS created_by, r.updated_at
         FROM house_rules r LEFT JOIN departments dep ON dep.id = r.department_id LEFT JOIN users u ON u.id = r.created_by
        WHERE $1::boolean OR r.department_id = $2 OR r.department_id IS NULL
        ORDER BY r.department_id NULLS FIRST, r.created_at`,
      [isAdmin(req), req.user.department_id],
    );
    return rows.map((r) => ({ ...r, can_edit: canManage(req, r.department_id) }));
  });

  app.post('/api/memory/rules', auth, async (req, reply) => {
    const body = z.object({ text: z.string().trim().min(5).max(500), departmentId: z.string().uuid().nullable().optional() }).parse(req.body);
    const departmentId = body.departmentId === undefined ? req.user.department_id : body.departmentId;
    if (!canManage(req, departmentId)) return reply.code(403).send({ error: 'Department leads add rules for their own department; admins for any department or company-wide' });
    const { rows } = await query(`INSERT INTO house_rules (department_id, text, created_by) VALUES ($1, $2, $3) RETURNING id`, [departmentId, body.text, req.user.id]);
    await writeAudit({ actorUserId: req.user.id, action: 'house_rule_added', targetType: 'house_rule', targetId: rows[0].id, detail: { department_id: departmentId } });
    return rows[0];
  });

  app.patch('/api/memory/rules/:id', auth, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ text: z.string().trim().min(5).max(500).optional(), isActive: z.boolean().optional() }).parse(req.body);
    const { rows } = await query(`SELECT department_id FROM house_rules WHERE id = $1`, [id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Not found' });
    if (!canManage(req, rows[0].department_id)) return reply.code(403).send({ error: 'Forbidden' });
    await query(`UPDATE house_rules SET text = COALESCE($2, text), is_active = COALESCE($3, is_active), updated_at = now() WHERE id = $1`, [id, body.text ?? null, body.isActive ?? null]);
    await writeAudit({ actorUserId: req.user.id, action: 'house_rule_updated', targetType: 'house_rule', targetId: id, detail: body });
    return { ok: true };
  });

  app.delete('/api/memory/rules/:id', auth, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { rows } = await query(`SELECT department_id FROM house_rules WHERE id = $1`, [id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Not found' });
    if (!canManage(req, rows[0].department_id)) return reply.code(403).send({ error: 'Forbidden' });
    await query(`DELETE FROM house_rules WHERE id = $1`, [id]);
    await writeAudit({ actorUserId: req.user.id, action: 'house_rule_deleted', targetType: 'house_rule', targetId: id, detail: {} });
    return { ok: true };
  });

  // ── Improvement report (admins) ──
  app.get('/api/memory/report', auth, async (req, reply) => {
    if (!isAdmin(req)) return reply.code(403).send({ error: 'Forbidden' });
    const { days } = z.object({ days: z.coerce.number().int().min(7).max(365).default(30) }).parse(req.query);
    return improvementReport(pool, days);
  });
}
