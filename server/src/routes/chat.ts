import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { writeAudit } from '../audit.js';
import { userKey } from '../auth/plugin.js';
import { config } from '../config.js';
import { pool, query, tx } from '../db/pool.js';
import { createPublisher, jobChannel, userChannel, type JobEvent } from '../queue/events.js';
import { enqueueMessage, getQueue, queuePosition } from '../queue/queue.js';
import { redis } from '../redis.js';
import { canUseCouncil } from '../settings.js';
import { hub, openSse } from '../sse.js';
import { createHash } from 'node:crypto';
import { renderReport } from '../report/councilReport.js';
import { loadReportData } from '../report/loadReport.js';
import { renderDocx } from '../report/docx.js';
import { verdictToMarkdown } from '../council/format.js';

const publisher = createPublisher(redis);

const SendMessage = z.object({
  conversationId: z.string().uuid().optional(),
  content: z.string().trim().min(1).max(8000),
  mode: z.enum(['auto', 'quick', 'council']).default('auto'),
  departmentId: z.string().uuid().optional(),
  peerReview: z.boolean().optional(),
  /** Answering the council's clarifying questions with "skip": proceed on its assumptions. */
  skipClarify: z.boolean().optional(),
  /** Council template key; the server looks up its mode / task / persona (never trusted from the client). */
  template: z.string().max(60).optional(),
});

const MESSAGE_COLUMNS = `m.id, m.conversation_id, m.role, m.content, m.reply_to, m.requested_mode, m.mode,
  m.department_id, m.status, m.stage, m.options, m.router, m.verdict, m.citations, m.cloud_used, m.error,
  m.created_at, m.completed_at`;

async function loadParts(messageIds: string[]) {
  if (!messageIds.length) return new Map<string, any[]>();
  const { rows } = await query(
    `SELECT p.message_id, p.stage, p.kind, p.persona_key, p.anon_label, p.content, p.data, p.model, p.latency_ms,
            pe.name AS persona_name
       FROM message_parts p LEFT JOIN personas pe ON pe.key = p.persona_key
      WHERE p.message_id = ANY($1::uuid[]) ORDER BY p.stage, pe.sort_order`,
    [messageIds],
  );
  const map = new Map<string, any[]>();
  for (const r of rows) {
    if (!map.has(r.message_id)) map.set(r.message_id, []);
    map.get(r.message_id)!.push(r);
  }
  return map;
}

async function ownedConversation(conversationId: string, userId: string) {
  const { rows } = await query('SELECT * FROM conversations WHERE id = $1 AND user_id = $2', [conversationId, userId]);
  return rows[0] ?? null;
}

async function ownedMessage(messageId: string, userId: string) {
  const { rows } = await query(
    `SELECT ${MESSAGE_COLUMNS}, f.rating AS my_rating
       FROM messages m JOIN conversations c ON c.id = m.conversation_id
       LEFT JOIN feedback f ON f.message_id = m.id AND f.user_id = $2
      WHERE m.id = $1 AND c.user_id = $2`,
    [messageId, userId],
  );
  return rows[0] ?? null;
}

export default async function chatRoutes(app: FastifyInstance) {
  const auth = { preHandler: app.authenticate };

  app.get('/api/departments', auth, async () => {
    const { rows } = await query(
      `SELECT id, slug, name, name_ms, description, review_before_acting FROM departments WHERE is_active ORDER BY name`,
    );
    return rows;
  });

  app.get('/api/templates', auth, async () => {
    const { rows } = await query(
      `SELECT key, title, title_ms, description, description_ms, mode, department_slug, fields
         FROM council_templates WHERE is_active ORDER BY sort_order, title`,
    );
    return rows;
  });

  app.get('/api/personas', auth, async () => {
    const { rows } = await query(
      `SELECT key, name, name_ms, description, in_council FROM personas WHERE is_active ORDER BY sort_order`,
    );
    return rows;
  });

  // ── Conversations ──
  app.get('/api/conversations', auth, async (req) => {
    const { q } = z.object({ q: z.string().trim().max(200).optional() }).parse(req.query);
    const params: unknown[] = [req.user.id];
    let filter = '';
    if (q) {
      params.push(`%${q}%`);
      filter = `AND (c.title ILIKE $2 OR EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.content ILIKE $2))`;
    }
    const { rows } = await query(
      `SELECT c.id, c.title, c.pinned, c.updated_at, c.department_id, d.name AS department_name,
              (SELECT m.status FROM messages m WHERE m.conversation_id = c.id AND m.role = 'assistant'
                ORDER BY m.created_at DESC LIMIT 1) AS last_status
         FROM conversations c JOIN departments d ON d.id = c.department_id
        WHERE c.user_id = $1 ${filter}
        ORDER BY c.pinned DESC, c.updated_at DESC LIMIT 200`,
      params,
    );
    return rows;
  });

  app.get('/api/conversations/:id', auth, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const conv = await ownedConversation(id, req.user.id);
    if (!conv) return reply.code(404).send({ error: 'Not found' });
    const { rows: messages } = await query(
      `SELECT ${MESSAGE_COLUMNS}, f.rating AS my_rating
         FROM messages m LEFT JOIN feedback f ON f.message_id = m.id AND f.user_id = $2
        WHERE m.conversation_id = $1 ORDER BY m.created_at, (m.role = 'assistant')`, // question and answer share a transaction timestamp
      [id, req.user.id],
    );
    const parts = await loadParts(messages.filter((m) => m.role === 'assistant').map((m) => m.id));
    return { conversation: conv, messages: messages.map((m) => ({ ...m, parts: parts.get(m.id) ?? [] })) };
  });

  app.patch('/api/conversations/:id', auth, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({ title: z.string().trim().min(1).max(120).optional(), pinned: z.boolean().optional() })
      .parse(req.body);
    const { rowCount } = await query(
      `UPDATE conversations SET title = COALESCE($3, title), pinned = COALESCE($4, pinned)
        WHERE id = $1 AND user_id = $2`,
      [id, req.user.id, body.title ?? null, body.pinned ?? null],
    );
    if (!rowCount) return reply.code(404).send({ error: 'Not found' });
    return { ok: true };
  });

  app.delete('/api/conversations/:id', auth, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { rowCount } = await query('DELETE FROM conversations WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    if (!rowCount) return reply.code(404).send({ error: 'Not found' });
    await writeAudit({ actorUserId: req.user.id, action: 'conversation_deleted', targetType: 'conversation', targetId: id, detail: {} });
    return { ok: true };
  });

  // PDPA: a user can delete their entire history.
  app.delete('/api/conversations', auth, async (req) => {
    const { rowCount } = await query('DELETE FROM conversations WHERE user_id = $1', [req.user.id]);
    await writeAudit({ actorUserId: req.user.id, action: 'history_deleted', detail: { conversations: rowCount } });
    return { ok: true, deleted: rowCount };
  });

  // ── Messages ──
  app.post(
    '/api/messages',
    {
      preHandler: app.authenticate,
      config: {
        rateLimit: {
          max: config.RATE_LIMIT_PER_MIN,
          timeWindow: '1 minute',
          keyGenerator: (req: any) => userKey(app, req),
        },
      },
    },
    async (req, reply) => {
      const body = SendMessage.parse(req.body);
      let templateOpts: Record<string, unknown> = {};
      if (body.template) {
        const { rows: tpl } = await query(`SELECT key, mode, task, persona FROM council_templates WHERE key = $1 AND is_active`, [body.template]);
        if (!tpl[0]) return reply.code(400).send({ error: 'Unknown template' });
        // A template collects the facts up front, so the council does not need to ask again.
        templateOpts = { template: tpl[0].key, task: tpl[0].task ?? undefined, persona: tpl[0].persona ?? undefined, skipClarify: true };
        body.mode = tpl[0].mode === 'council' ? 'council' : 'quick';
      }
      if (body.mode === 'council' && !(await canUseCouncil(req.user.role))) {
        return reply.code(403).send({ error: 'Council mode is not enabled for your role yet.' });
      }

      const departmentId = body.departmentId ?? req.user.department_id;
      const dept = await query('SELECT id FROM departments WHERE id = $1 AND is_active', [departmentId]);
      if (!dept.rows[0]) return reply.code(400).send({ error: 'Unknown department' });

      const result = await tx(async (c) => {
        let conversation;
        if (body.conversationId) {
          const r = await c.query('SELECT * FROM conversations WHERE id = $1 AND user_id = $2', [
            body.conversationId,
            req.user.id,
          ]);
          conversation = r.rows[0];
          if (!conversation) return null;
        } else {
          const title = body.content.replace(/\s+/g, ' ').slice(0, 70);
          const r = await c.query(
            `INSERT INTO conversations (user_id, department_id, title) VALUES ($1, $2, $3) RETURNING *`,
            [req.user.id, departmentId, title],
          );
          conversation = r.rows[0];
        }
        const userMsg = (
          await c.query(
            `INSERT INTO messages (conversation_id, role, content, department_id) VALUES ($1, 'user', $2, $3) RETURNING *`,
            [conversation.id, body.content, departmentId],
          )
        ).rows[0];
        const assistant = (
          await c.query(
            `INSERT INTO messages (conversation_id, role, reply_to, requested_mode, department_id, status, options)
             VALUES ($1, 'assistant', $2, $3, $4, 'queued', $5) RETURNING *`,
            [conversation.id, userMsg.id, body.mode, departmentId, JSON.stringify({ peerReview: body.peerReview, skipClarify: body.skipClarify, ...templateOpts })],
          )
        ).rows[0];
        await c.query('UPDATE conversations SET updated_at = now() WHERE id = $1', [conversation.id]);
        return { conversation, userMessage: userMsg, assistantMessage: { ...assistant, parts: [] } };
      });
      if (!result) return reply.code(404).send({ error: 'Conversation not found' });

      // "Who asked what": the audit row references the message and fingerprints its text,
      // so deleting history (PDPA) removes the content without breaking the audit trail.
      await writeAudit({
        actorUserId: req.user.id,
        action: 'question_asked',
        targetType: 'message',
        targetId: result.userMessage.id,
        ip: req.ip,
        detail: {
          conversation_id: result.conversation.id,
          assistant_message_id: result.assistantMessage.id,
          department_id: departmentId,
          requested_mode: body.mode,
          length: body.content.length,
          sha256: createHash('sha256').update(body.content).digest('hex'),
        },
      });
      await enqueueMessage(result.assistantMessage.id, body.mode);
      return result;
    },
  );

  /** Live progress for one assistant message. Safe to reconnect: starts with a full snapshot. */
  app.get('/api/messages/:id/stream', auth, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const initial = await ownedMessage(id, req.user.id);
    if (!initial || initial.role !== 'assistant') return reply.code(404).send({ error: 'Not found' });

    const sse = openSse(req, reply);
    const buffered: JobEvent[] = [];
    let live = false;
    const deliver = (e: JobEvent) => {
      sse.send(e.type, e);
      if (e.type === 'done' || e.type === 'error') sse.close();
    };
    // Subscribe before reading the snapshot so nothing is lost in between.
    const unsubscribe = await hub.subscribe(jobChannel(id), (payload) => {
      const e = JSON.parse(payload) as JobEvent;
      if (live) deliver(e);
      else buffered.push(e);
    });
    sse.onClose(() => void unsubscribe());

    const message = await ownedMessage(id, req.user.id);
    const parts = (await loadParts([id])).get(id) ?? [];
    const partials = message.status === 'running' || message.status === 'queued' ? await publisher.partials(id) : {};
    const position = message.status === 'queued' ? await queuePosition(id) : null;
    sse.send('snapshot', { message: { ...message, parts }, partials, position });
    if (message.status === 'done' || message.status === 'error') {
      sse.close();
      return;
    }
    live = true;
    for (const e of buffered) deliver(e);
  });

  /** Per-user notifications (e.g. a council run finished while the user was elsewhere). */
  app.get('/api/events', auth, async (req, reply) => {
    const sse = openSse(req, reply);
    const unsubscribe = await hub.subscribe(userChannel(req.user.id), (payload) => {
      const e = JSON.parse(payload);
      sse.send(e.type, e);
    });
    sse.onClose(() => void unsubscribe());
    sse.send('hello', { ok: true });
  });

  app.post('/api/messages/:id/feedback', auth, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({ rating: z.union([z.literal(1), z.literal(-1)]), comment: z.string().max(2000).optional() })
      .parse(req.body);
    const msg = await ownedMessage(id, req.user.id);
    if (!msg || msg.role !== 'assistant') return reply.code(404).send({ error: 'Not found' });
    await query(
      `INSERT INTO feedback (message_id, user_id, rating, comment) VALUES ($1, $2, $3, $4)
       ON CONFLICT (message_id, user_id) DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, created_at = now()`,
      [id, req.user.id, body.rating, body.comment ?? null],
    );
    return { ok: true };
  });

  /** Council report / answer as a PDF with analytics (generated on the server). */
  app.get('/api/messages/:id/report.pdf', auth, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const data = await loadReportData(pool, id, req.user.id);
    if (!data) return reply.code(404).send({ error: 'No finished answer to export' });
    const pdf = await renderReport(data);
    await writeAudit({ actorUserId: req.user.id, action: 'report_exported', targetType: 'message', targetId: id, detail: { mode: data.mode, bytes: pdf.length } });
    const slug = data.title.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'report';
    return reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `attachment; filename="Xanderia-AI-Council-${slug}.pdf"`)
      .header('cache-control', 'private, no-store')
      .send(pdf);
  });

  /** Any finished answer as an editable Word document (drafts, SOPs, letters, verdicts). */
  app.get('/api/messages/:id/export.docx', auth, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const data = await loadReportData(pool, id, req.user.id);
    if (!data) return reply.code(404).send({ error: 'No finished answer to export' });
    const markdown = data.verdict ? verdictToMarkdown(data.verdict) : data.content;
    const buf = await renderDocx({
      title: data.title,
      subtitle: `${data.department.name} · asked by ${data.askedBy} · ${(data.completedAt ?? data.createdAt).toISOString().slice(0, 10)}`,
      markdown,
    });
    await writeAudit({ actorUserId: req.user.id, action: 'docx_exported', targetType: 'message', targetId: id, detail: { bytes: buf.length } });
    const slug = data.title.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'answer';
    return reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .header('content-disposition', `attachment; filename="Xanderia-AI-Council-${slug}.docx"`)
      .header('cache-control', 'private, no-store')
      .send(buf);
  });

  /**
   * What-if: change one assumption of a verdict and re-run part of the council. Creates a new
   * question/answer pair in the same conversation.
   */
  app.post('/api/messages/:id/whatif', auth, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { change } = z.object({ change: z.string().trim().min(3).max(1000) }).parse(req.body);
    const base = await ownedMessage(id, req.user.id);
    if (!base || base.mode !== 'council' || !base.verdict) return reply.code(404).send({ error: 'Only a finished council verdict can be re-run' });
    const { rows: q } = await query(
      `SELECT COALESCE(m.options->>'effectiveQuestion', u.content) AS question FROM messages m JOIN messages u ON u.id = m.reply_to WHERE m.id = $1`,
      [id],
    );
    const content = `What if: ${change}`;
    const result = await tx(async (c) => {
      const userMsg = (
        await c.query(`INSERT INTO messages (conversation_id, role, content, department_id) VALUES ($1, 'user', $2, $3) RETURNING *`, [
          base.conversation_id,
          content,
          base.department_id,
        ])
      ).rows[0];
      const assistant = (
        await c.query(
          `INSERT INTO messages (conversation_id, role, reply_to, requested_mode, department_id, status, options)
           VALUES ($1, 'assistant', $2, 'council', $3, 'queued', $4) RETURNING *`,
          [
            base.conversation_id,
            userMsg.id,
            base.department_id,
            JSON.stringify({ skipClarify: true, whatIf: { base: id, change }, effectiveQuestion: `${q[0].question}\n\nWHAT-IF (changed assumption): ${change}` }),
          ],
        )
      ).rows[0];
      await c.query('UPDATE conversations SET updated_at = now() WHERE id = $1', [base.conversation_id]);
      return { userMessage: userMsg, assistantMessage: { ...assistant, parts: [] } };
    });
    await writeAudit({ actorUserId: req.user.id, action: 'what_if', targetType: 'message', targetId: result.assistantMessage.id, detail: { base: id } });
    await enqueueMessage(result.assistantMessage.id, 'council');
    return result;
  });

  /** Retry a failed answer. */
  app.post('/api/messages/:id/retry', auth, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const msg = await ownedMessage(id, req.user.id);
    if (!msg || msg.role !== 'assistant') return reply.code(404).send({ error: 'Not found' });
    if (msg.status !== 'error') return reply.code(409).send({ error: 'Only failed answers can be retried' });
    await query(
      `UPDATE messages SET status = 'queued', error = NULL, stage = NULL, content = '', verdict = NULL, completed_at = NULL WHERE id = $1`,
      [id],
    );
    const job = await getQueue().getJob(id);
    if (job) await job.remove().catch(() => {});
    await enqueueMessage(id, msg.requested_mode ?? 'auto');
    return { ok: true };
  });
}
