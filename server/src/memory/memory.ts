import type { Queryable } from '../db/pool.js';
import { accessibleDepartmentIds } from '../rag/access.js';
import { toVectorLiteral } from '../rag/retrieve.js';

/**
 * Company memory: what the council is shown, besides documents, so it gets better as people use it.
 * - lessons: past decisions (with their outcomes) similar to the question, as far as the asker may see them;
 * - approved answers: answers a lead or admin approved for similar questions;
 * - house rules: short facts a lead wrote for the department (always included).
 * Nothing from private conversations is shared unless the asker suggested it and a lead approved it.
 */

/** Cosine distance limits (nomic-embed-text): only close matches are worth showing. */
export const MEMORY_LIMITS = { lesson: 0.45, approved: 0.35 } as const;

export interface Lesson {
  title: string;
  summary: string;
  department: string | null;
  decided: string;
  status: string;
  outcome: { rating: string; note: string | null } | null;
  distance: number;
}
export interface ApprovedAnswer {
  question: string;
  answer: string;
  distance: number;
}
export interface HouseRule {
  text: string;
  department: string | null;
}

export async function findLessons(db: Queryable, user: { id: string; department_id: string }, vector: number[], k = 3): Promise<Lesson[]> {
  const { rows } = await db.query(
    `SELECT d.title, d.summary, dep.name AS department, to_char(d.decided_at, 'YYYY-MM-DD') AS decided, d.status,
            (SELECT json_build_object('rating', o.rating, 'note', o.note) FROM decision_outcomes o
              WHERE o.decision_id = d.id ORDER BY o.created_at DESC LIMIT 1) AS outcome,
            (d.embedding <=> $1::vector) AS distance
       FROM decisions d LEFT JOIN departments dep ON dep.id = d.department_id
      WHERE d.embedding IS NOT NULL AND d.status <> 'dropped'
        AND (d.visibility = 'company' OR d.department_id = $2 OR d.recorded_by = $3)
      ORDER BY d.embedding <=> $1::vector
      LIMIT $4`,
    [toVectorLiteral(vector), user.department_id, user.id, k],
  );
  return rows.filter((r: Lesson) => r.distance < MEMORY_LIMITS.lesson);
}

export async function findApprovedAnswers(db: Queryable, user: { id: string; department_id: string }, vector: number[], k = 2): Promise<ApprovedAnswer[]> {
  const allowed = await accessibleDepartmentIds(db, user);
  const { rows } = await db.query(
    `SELECT a.question, a.answer, (a.embedding <=> $1::vector) AS distance
       FROM approved_answers a
      WHERE a.status = 'approved' AND a.embedding IS NOT NULL
        AND (a.department_id IS NULL OR a.department_id = ANY($2::uuid[]))
      ORDER BY a.embedding <=> $1::vector
      LIMIT $3`,
    [toVectorLiteral(vector), allowed, k],
  );
  return rows.filter((r: ApprovedAnswer) => r.distance < MEMORY_LIMITS.approved);
}

export async function houseRulesFor(db: Queryable, departmentId: string, limit = 25): Promise<HouseRule[]> {
  const { rows } = await db.query(
    `SELECT r.text, dep.name AS department FROM house_rules r LEFT JOIN departments dep ON dep.id = r.department_id
      WHERE r.is_active AND (r.department_id IS NULL OR r.department_id = $1)
      ORDER BY r.department_id NULLS FIRST, r.created_at
      LIMIT $2`,
    [departmentId, limit],
  );
  return rows;
}

const RATING: Record<string, string> = { worked: 'worked', partly: 'partly worked', did_not_work: 'did not work', too_early: 'too early to tell' };
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).replace(/\s+\S*$/, '')} …` : s);

/** The memory block given to the model, or '' when there is nothing relevant. */
export function memoryBlock(m: { lessons: Lesson[]; approved: ApprovedAnswer[]; rules: HouseRule[] }) {
  const parts: string[] = [];
  if (m.rules.length) {
    parts.push(
      `Xanderia house rules (set by department leads; always follow them, and say so if a plan breaks one):\n${m.rules
        .map((r) => `- ${r.text}${r.department ? '' : ' (company-wide)'}`)
        .join('\n')}`,
    );
  }
  if (m.approved.length) {
    parts.push(
      `Approved company answers to similar questions (checked by a lead; reuse them where they fit, and prefer them over general knowledge):\n${m.approved
        .map((a) => `- Q: ${clip(a.question, 300)}\n  A: ${clip(a.answer, 1500)}`)
        .join('\n')}`,
    );
  }
  if (m.lessons.length) {
    parts.push(
      `Lessons from past Xanderia decisions on similar topics (learn from what worked and what did not):\n${m.lessons
        .map(
          (l) =>
            `- ${l.decided}${l.department ? `, ${l.department}` : ''}: "${clip(l.title, 160)}". ${clip(l.summary, 400)} ` +
            (l.outcome ? `Outcome: ${RATING[l.outcome.rating] ?? l.outcome.rating}${l.outcome.note ? ` (${clip(l.outcome.note, 300)})` : ''}.` : `Outcome not recorded yet (status: ${l.status}).`),
        )
        .join('\n')}`,
    );
  }
  return parts.join('\n\n');
}

/** Everything relevant for one question. A failed lookup never blocks the answer. */
export async function recallMemory(
  db: Queryable,
  embed: (texts: string[]) => Promise<number[][]>,
  user: { id: string; department_id: string },
  departmentId: string,
  question: string,
) {
  const rules = await houseRulesFor(db, departmentId).catch(() => [] as HouseRule[]);
  let lessons: Lesson[] = [];
  let approved: ApprovedAnswer[] = [];
  try {
    const any = await db.query(
      `SELECT EXISTS (SELECT 1 FROM decisions WHERE embedding IS NOT NULL) AS d,
              EXISTS (SELECT 1 FROM approved_answers WHERE status = 'approved' AND embedding IS NOT NULL) AS a`,
    );
    if (any.rows[0].d || any.rows[0].a) {
      const [vector] = await embed([question]);
      if (any.rows[0].d) lessons = await findLessons(db, user, vector);
      if (any.rows[0].a) approved = await findApprovedAnswers(db, user, vector);
    }
  } catch (err) {
    console.warn(`[memory] recall skipped: ${(err as Error).message}`);
  }
  const block = memoryBlock({ lessons, approved, rules });
  return { block, counts: { lessons: lessons.length, approved: approved.length, rules: rules.length } };
}

/** Embed a decision so later questions can find it (title + summary). */
export async function indexDecision(db: Queryable, embed: (texts: string[]) => Promise<number[][]>, decisionId: string) {
  const { rows } = await db.query(`SELECT title, summary FROM decisions WHERE id = $1`, [decisionId]);
  if (!rows[0]) return;
  const [v] = await embed([`${rows[0].title}\n${rows[0].summary}`]);
  await db.query(`UPDATE decisions SET embedding = $2::vector WHERE id = $1`, [decisionId, toVectorLiteral(v)]);
}

/** Embed an approved answer by its question (what future askers will type). */
export async function indexApprovedAnswer(db: Queryable, embed: (texts: string[]) => Promise<number[][]>, id: string) {
  const { rows } = await db.query(`SELECT question FROM approved_answers WHERE id = $1`, [id]);
  if (!rows[0]) return;
  const [v] = await embed([rows[0].question]);
  await db.query(`UPDATE approved_answers SET embedding = $2::vector WHERE id = $1`, [id, toVectorLiteral(v)]);
}

/** Decisions recorded before memory existed (or while the model was down) get embedded on start. */
export async function backfillDecisionEmbeddings(db: Queryable, embed: (texts: string[]) => Promise<number[][]>) {
  const { rows } = await db.query(`SELECT id FROM decisions WHERE embedding IS NULL LIMIT 500`);
  let n = 0;
  for (const r of rows) {
    try {
      await indexDecision(db, embed, r.id);
      n++;
    } catch {
      break; // embedding model unavailable: try again next start
    }
  }
  return n;
}
