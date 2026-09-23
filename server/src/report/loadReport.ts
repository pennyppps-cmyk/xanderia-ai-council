import type { Stance } from '../council/format.js';
import { parseStance } from '../council/format.js';
import type { Queryable } from '../db/pool.js';
import type { ReportData } from './councilReport.js';

/** Load everything the report needs. Returns null unless the message belongs to `userId`. */
export async function loadReportData(db: Queryable, messageId: string, userId: string): Promise<ReportData | null> {
  const { rows } = await db.query(
    `SELECT m.id, m.mode, m.status, m.content, m.verdict, m.citations, m.cloud_used, m.router, m.options,
            m.created_at, m.completed_at,
            q.content AS question, c.title, u.display_name,
            d.name AS dept_name, d.review_before_acting
       FROM messages m
       JOIN messages q ON q.id = m.reply_to
       JOIN conversations c ON c.id = m.conversation_id
       JOIN users u ON u.id = c.user_id
       JOIN departments d ON d.id = m.department_id
      WHERE m.id = $1 AND c.user_id = $2 AND m.role = 'assistant'`,
    [messageId, userId],
  );
  const m = rows[0];
  if (!m || m.status !== 'done' || (m.mode !== 'quick' && m.mode !== 'council')) return null;

  const { rows: parts } = await db.query(
    `SELECT p.stage, p.persona_key, p.content, p.data, pe.name
       FROM message_parts p LEFT JOIN personas pe ON pe.key = p.persona_key
      WHERE p.message_id = $1 ORDER BY p.stage, pe.sort_order`,
    [messageId],
  );
  const nameOf = (key: string) => parts.find((p) => p.persona_key === key)?.name ?? key;

  return {
    title: m.title,
    // After clarifying questions, the council considered the original question plus the answers.
    question: m.options?.effectiveQuestion ?? m.question,
    askedBy: m.display_name,
    department: { name: m.dept_name, reviewBeforeActing: m.review_before_acting },
    createdAt: new Date(m.created_at),
    completedAt: m.completed_at ? new Date(m.completed_at) : null,
    mode: m.mode,
    cloudUsed: m.cloud_used,
    intent: m.router?.intent ?? null,
    verdict: m.verdict,
    content: m.content,
    opinions: parts
      .filter((p) => p.stage === 1)
      .map((p) => ({
        key: p.persona_key,
        name: p.name ?? p.persona_key,
        content: p.content,
        // Opinions stored before stances were recorded are parsed on the fly.
        stance: (p.data?.stance as Stance | undefined) ?? (p.content ? parseStance(p.content) : null),
      })),
    reviews: parts
      .filter((p) => p.stage === 2)
      .map((p) => ({ reviewerKey: p.persona_key, reviewerName: nameOf(p.persona_key), scores: p.data?.scores ?? {} })),
    citations: m.citations ?? [],
  };
}
