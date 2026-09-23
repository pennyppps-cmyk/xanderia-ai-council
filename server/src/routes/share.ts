import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { writeAudit } from '../audit.js';
import { query } from '../db/pool.js';

/**
 * Share links (HANDOFF §7): the owner of a finished answer creates a link; any signed-in
 * colleague can open a read-only copy. Sharing is the owner's explicit choice, can be
 * revoked, and every view is audited.
 */
export default async function shareRoutes(app: FastifyInstance) {
  const auth = { preHandler: app.authenticate };

  async function ownedFinished(messageId: string, userId: string) {
    const { rows } = await query(
      `SELECT m.id FROM messages m JOIN conversations c ON c.id = m.conversation_id
        WHERE m.id = $1 AND c.user_id = $2 AND m.role = 'assistant' AND m.status = 'done'`,
      [messageId, userId],
    );
    return Boolean(rows[0]);
  }

  app.post('/api/messages/:id/share', auth, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    if (!(await ownedFinished(id, req.user.id))) return reply.code(404).send({ error: 'Not found' });
    const existing = await query(`SELECT token FROM message_shares WHERE message_id = $1 AND revoked_at IS NULL`, [id]);
    if (existing.rows[0]) return { token: existing.rows[0].token, path: `/shared/${existing.rows[0].token}` };
    const token = randomBytes(18).toString('base64url');
    await query(`INSERT INTO message_shares (token, message_id, created_by) VALUES ($1, $2, $3)`, [token, id, req.user.id]);
    await writeAudit({ actorUserId: req.user.id, action: 'share_created', targetType: 'message', targetId: id, detail: {} });
    return { token, path: `/shared/${token}` };
  });

  app.delete('/api/messages/:id/share', auth, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    if (!(await ownedFinished(id, req.user.id))) return reply.code(404).send({ error: 'Not found' });
    await query(`UPDATE message_shares SET revoked_at = now() WHERE message_id = $1 AND revoked_at IS NULL`, [id]);
    await writeAudit({ actorUserId: req.user.id, action: 'share_revoked', targetType: 'message', targetId: id, detail: {} });
    return { ok: true };
  });

  app.get('/api/shared/:token', auth, async (req, reply) => {
    const { token } = z.object({ token: z.string().min(10).max(64) }).parse(req.params);
    const { rows } = await query(
      `SELECT m.id, m.conversation_id, m.role, m.content, m.reply_to, m.requested_mode, m.mode, m.department_id, m.status,
              m.stage, m.options, m.router, m.verdict, m.citations, m.cloud_used, m.error, m.created_at, m.completed_at,
              COALESCE(m.options->>'effectiveQuestion', q.content) AS question, c.title, u.display_name AS shared_by, s.created_at AS shared_at
         FROM message_shares s
         JOIN messages m ON m.id = s.message_id
         JOIN messages q ON q.id = m.reply_to
         JOIN conversations c ON c.id = m.conversation_id
         JOIN users u ON u.id = s.created_by
        WHERE s.token = $1 AND s.revoked_at IS NULL`,
      [token],
    );
    const m = rows[0];
    if (!m) return reply.code(404).send({ error: 'This share link is not valid or was revoked' });
    const { rows: parts } = await query(
      `SELECT p.stage, p.kind, p.persona_key, p.anon_label, p.content, p.data, p.model, p.latency_ms, pe.name AS persona_name
         FROM message_parts p LEFT JOIN personas pe ON pe.key = p.persona_key
        WHERE p.message_id = $1 ORDER BY p.stage, pe.sort_order`,
      [m.id],
    );
    await writeAudit({ actorUserId: req.user.id, action: 'share_viewed', targetType: 'message', targetId: m.id, detail: {} });
    const { question, title, shared_by, shared_at, ...message } = m;
    return { title, question, sharedBy: shared_by, sharedAt: shared_at, message: { ...message, parts } };
  });
}
