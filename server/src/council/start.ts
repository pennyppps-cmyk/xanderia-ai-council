import { createHash } from 'node:crypto';
import { writeAudit } from '../audit.js';
import { tx } from '../db/pool.js';
import { enqueueMessage } from '../queue/queue.js';

/**
 * Starts a council run on someone's behalf (a portfolio limit was broken, a goal needs a plan).
 * It appears as a new conversation of theirs, so they read the verdict and put it into action
 * the usual way. Clarifying questions are skipped: nobody is waiting at the screen to answer.
 */
export async function startCouncil(o: { userId: string; departmentId: string; title: string; question: string; purpose: string }) {
  const r = await tx(async (c) => {
    const conv = (
      await c.query(`INSERT INTO conversations (user_id, department_id, title) VALUES ($1, $2, $3) RETURNING id`, [o.userId, o.departmentId, o.title.slice(0, 70)])
    ).rows[0];
    const q = (
      await c.query(`INSERT INTO messages (conversation_id, role, content, department_id) VALUES ($1, 'user', $2, $3) RETURNING id`, [conv.id, o.question, o.departmentId])
    ).rows[0];
    const a = (
      await c.query(
        `INSERT INTO messages (conversation_id, role, reply_to, requested_mode, department_id, status, options)
         VALUES ($1, 'assistant', $2, 'council', $3, 'queued', $4) RETURNING id`,
        [conv.id, q.id, o.departmentId, JSON.stringify({ skipClarify: true, automatic: o.purpose })],
      )
    ).rows[0];
    return { conversationId: conv.id as string, questionId: q.id as string, messageId: a.id as string };
  });
  await writeAudit({
    actorUserId: o.userId,
    action: 'question_asked',
    targetType: 'message',
    targetId: r.questionId,
    detail: { conversation_id: r.conversationId, assistant_message_id: r.messageId, department_id: o.departmentId, requested_mode: 'council', automatic: o.purpose, length: o.question.length, sha256: createHash('sha256').update(o.question).digest('hex') },
  });
  await enqueueMessage(r.messageId, 'council');
  return r;
}
