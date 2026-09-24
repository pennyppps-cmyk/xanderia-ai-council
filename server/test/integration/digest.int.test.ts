/**
 *   TEST_DATABASE_URL=postgres://council:council@localhost:5433/council_digest_test TEST_REDIS_URL=redis://localhost:6380 npm test
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;

describe.skipIf(!url || !redisUrl)('weekly digest and knowledge freshness (integration)', () => {
  let jobs: typeof import('../../src/jobs.js');
  let db: pg.Pool;
  const ids: Record<string, string> = {};

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
    jobs = await import('../../src/jobs.js');
    db = new pg.Pool({ connectionString: url });
    ids.dept = (await db.query(`SELECT id FROM departments WHERE slug = 'finance'`)).rows[0].id;
    ids.lead = (
      await db.query(`INSERT INTO users (email, display_name, role, department_id) VALUES ('lead@x.test', 'Fin Lead', 'dept_lead', $1) RETURNING id`, [ids.dept])
    ).rows[0].id;
    ids.staff = (
      await db.query(`INSERT INTO users (email, display_name, role, department_id) VALUES ('staff@x.test', 'Staff', 'employee', $1) RETURNING id`, [ids.dept])
    ).rows[0].id;
    const conv = (await db.query(`INSERT INTO conversations (user_id, department_id) VALUES ($1, $2) RETURNING id`, [ids.staff, ids.dept])).rows[0].id;
    for (let i = 0; i < 3; i++) {
      const q = (await db.query(`INSERT INTO messages (conversation_id, role, content) VALUES ($1, 'user', 'SECRET QUESTION TEXT') RETURNING id`, [conv])).rows[0].id;
      await db.query(
        `INSERT INTO messages (conversation_id, role, reply_to, mode, status, department_id, router) VALUES ($1, 'assistant', $2, $3, 'done', $4, '{"department":"legal-compliance"}')`,
        [conv, q, i ? 'quick' : 'council', ids.dept],
      );
    }
    ids.oldDoc = (
      await db.query(
        `INSERT INTO documents (department_id, title, uploaded_by, created_at, review_after_days) VALUES ($1, 'Old SOP', $2, now() - interval '200 days', 180) RETURNING id`,
        [ids.dept, ids.staff],
      )
    ).rows[0].id;
    await db.query(`INSERT INTO documents (department_id, title, uploaded_by) VALUES ($1, 'Fresh policy', $2)`, [ids.dept, ids.staff]);
  });

  afterAll(async () => {
    await db?.end();
    await (await import('../../src/db/pool.js')).pool.end();
    (await import('../../src/redis.js')).redis.disconnect();
  });

  it('flags stale documents to the uploader and the department lead, once', async () => {
    expect(await jobs.knowledgeFreshness()).toBe(1);
    const n = await db.query(`SELECT user_id FROM notifications WHERE kind = 'knowledge_stale' ORDER BY user_id`);
    expect(n.rows.map((r) => r.user_id).sort()).toEqual([ids.lead, ids.staff].sort());
    expect(await jobs.knowledgeFreshness()).toBe(0);
  });

  it('builds a counts-only digest and emails the department head', async () => {
    const d = await jobs.digestFor(ids.dept);
    expect(d.questions).toBe(3);
    expect(d.council).toBe(1);
    expect(d.areas).toEqual([{ area: 'Legal & Compliance', n: 3 }].map((a) => ({ ...a, area: expect.any(String) })));
    expect(d.stale.map((s) => s.title)).toEqual(['Old SOP']);
    expect(await jobs.weeklyDigests()).toBe(1);
    const e = await db.query(`SELECT to_email, subject, body_text FROM outbound_emails WHERE kind = 'digest'`);
    expect(e.rows).toHaveLength(1);
    expect(e.rows[0].to_email).toBe('lead@x.test');
    expect(e.rows[0].body_text).toContain('QUESTIONS: 3 this week');
    expect(e.rows[0].body_text).toContain('Old SOP');
    expect(e.rows[0].body_text).not.toContain('SECRET QUESTION TEXT');
  });

  it('skips heads who opted out', async () => {
    await db.query(`UPDATE users SET weekly_digest = false WHERE id = $1`, [ids.lead]);
    expect(await jobs.weeklyDigests()).toBe(0);
  });
});
