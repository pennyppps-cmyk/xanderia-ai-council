/**
 *   TEST_DATABASE_URL=postgres://council:council@localhost:5433/council_mem_test TEST_REDIS_URL=redis://localhost:6380 npm test
 * Company memory respects who may see what (decision visibility, department access, approval).
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;

describe.skipIf(!url || !redisUrl)('company memory (integration)', () => {
  let mem: typeof import('../../src/memory/memory.js');
  let db: pg.Pool;
  const ids: Record<string, string> = {};
  // Fake embeddings: a unit vector on one axis. Same axis = same topic (distance 0); another axis = unrelated (distance 1).
  const axis = (i: number) => Array.from({ length: 768 }, (_, j) => (j === i ? 1 : 0));
  const vec = (i: number) => `[${axis(i).join(',')}]`;

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: url!.replace(/\/[^/]+$/, '/postgres') });
    await admin.connect();
    const name = new URL(url!).pathname.slice(1);
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${name}`);
    await admin.end();
    process.env.DATABASE_URL = url;
    process.env.REDIS_URL = redisUrl;
    await (await import('../../src/db/migrate.js')).migrate(url!, () => {});
    await (await import('../../src/db/seed.js')).seed(() => {});
    mem = await import('../../src/memory/memory.js');
    db = new pg.Pool({ connectionString: url });
    const dept = async (slug: string) => (await db.query(`SELECT id FROM departments WHERE slug = $1`, [slug])).rows[0].id;
    ids.fin = await dept('finance');
    ids.hr = await dept('hr');
    const user = async (email: string, d: string) =>
      (await db.query(`INSERT INTO users (email, display_name, role, department_id) VALUES ($1, $1, 'employee', $2) RETURNING id`, [email, d])).rows[0].id;
    ids.finUser = await user('fin@x.test', ids.fin);
    ids.hrUser = await user('hr@x.test', ids.hr);
    const conv = (await db.query(`INSERT INTO conversations (user_id, department_id) VALUES ($1, $2) RETURNING id`, [ids.hrUser, ids.hr])).rows[0].id;
    const decision = async (title: string, d: string, visibility: string, v: number, outcome?: string) => {
      const q = (await db.query(`INSERT INTO messages (conversation_id, role, content) VALUES ($1, 'user', 'q') RETURNING id`, [conv])).rows[0].id;
      const m = (await db.query(`INSERT INTO messages (conversation_id, role, reply_to, mode, status, verdict) VALUES ($1, 'assistant', $2, 'council', 'done', '{"verdict":"x"}') RETURNING id`, [conv, q])).rows[0].id;
      const id = (
        await db.query(
          `INSERT INTO decisions (message_id, recorded_by, department_id, title, summary, visibility, embedding) VALUES ($1, $2, $3, $4, 'summary', $5, $6::vector) RETURNING id`,
          [m, ids.hrUser, d, title, visibility, vec(v)],
        )
      ).rows[0].id;
      if (outcome) await db.query(`INSERT INTO decision_outcomes (decision_id, rating, note, recorded_by) VALUES ($1, $2, 'cure rate up 12%', $3)`, [id, outcome, ids.hrUser]);
    };
    await decision('Company-wide NPL pilot', ids.hr, 'company', 1, 'worked');
    await decision('HR-only NPL review', ids.hr, 'department', 1);
    await decision('Unrelated office move', ids.hr, 'company', 2);
    const answer = async (q: string, d: string | null, status: string, v: number) =>
      db.query(`INSERT INTO approved_answers (department_id, question, answer, status, embedding) VALUES ($1, $2, 'the answer', $3, $4::vector)`, [d, q, status, vec(v)]);
    await answer('HR NPL answer', ids.hr, 'approved', 1);
    await answer('Company NPL answer', null, 'approved', 1);
    await answer('Pending NPL answer', null, 'suggested', 1);
    await db.query(`INSERT INTO house_rules (department_id, text) VALUES ($1, 'Finance: NPL is 90 days past due.'), (NULL, 'Everyone: amounts in RM.'), ($2, 'HR: leave year starts in January.')`, [ids.fin, ids.hr]);
  });

  afterAll(async () => {
    await db?.end();
    await (await import('../../src/db/pool.js')).pool.end();
    (await import('../../src/redis.js')).redis.disconnect();
  });

  it('shows past decisions only as far as the asker may see them, with outcomes, and only when related', async () => {
    const forFinance = await mem.findLessons(db, { id: ids.finUser, department_id: ids.fin }, axis(1));
    expect(forFinance.map((l) => l.title)).toEqual(['Company-wide NPL pilot']); // not the HR-only one, not the unrelated one
    expect(forFinance[0].outcome).toEqual({ rating: 'worked', note: 'cure rate up 12%' });
    const forHr = await mem.findLessons(db, { id: ids.hrUser, department_id: ids.hr }, axis(1));
    expect(forHr.map((l) => l.title).sort()).toEqual(['Company-wide NPL pilot', 'HR-only NPL review']);
  });

  it('uses approved answers from the asker’s department and company-wide ones, never pending ones', async () => {
    const fin = await mem.findApprovedAnswers(db, { id: ids.finUser, department_id: ids.fin }, axis(1));
    expect(fin.map((a) => a.question)).toEqual(['Company NPL answer']);
    const hr = await mem.findApprovedAnswers(db, { id: ids.hrUser, department_id: ids.hr }, axis(1));
    expect(hr.map((a) => a.question).sort()).toEqual(['Company NPL answer', 'HR NPL answer']);
  });

  it('gives the routed department’s house rules plus company-wide ones', async () => {
    expect((await mem.houseRulesFor(db, ids.fin)).map((r) => r.text)).toEqual(['Everyone: amounts in RM.', 'Finance: NPL is 90 days past due.']);
  });

  it('recalls everything for a question in one call', async () => {
    const r = await mem.recallMemory(db, async () => [axis(1)], { id: ids.finUser, department_id: ids.fin }, ids.fin, 'How do we compute NPL?');
    expect(r.counts).toEqual({ lessons: 1, approved: 1, rules: 2 });
    expect(r.block).toContain('Finance: NPL is 90 days past due.');
  });
});
