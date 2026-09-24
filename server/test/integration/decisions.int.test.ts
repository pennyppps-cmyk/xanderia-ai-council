/**
 *   TEST_DATABASE_URL=postgres://council:council@localhost:5433/council_dec_test TEST_REDIS_URL=redis://localhost:6380 npm test
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;

describe.skipIf(!url || !redisUrl)('decision check-ins (integration)', () => {
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
    ids.user = (await db.query(`SELECT id, department_id FROM users LIMIT 1`)).rows[0].id;
    const dept = (await db.query(`SELECT department_id FROM users WHERE id = $1`, [ids.user])).rows[0].department_id;
    const conv = (await db.query(`INSERT INTO conversations (user_id, department_id) VALUES ($1, $2) RETURNING id`, [ids.user, dept])).rows[0].id;
    const mk = async (title: string, status: string, ageDays: number) => {
      const q = (await db.query(`INSERT INTO messages (conversation_id, role, content) VALUES ($1, 'user', 'q') RETURNING id`, [conv])).rows[0].id;
      const m = (await db.query(`INSERT INTO messages (conversation_id, role, reply_to, mode, status, verdict) VALUES ($1, 'assistant', $2, 'council', 'done', '{"verdict":"x"}') RETURNING id`, [conv, q])).rows[0].id;
      return (
        await db.query(
          `INSERT INTO decisions (message_id, recorded_by, department_id, title, summary, status, decided_at, next_check_in)
           VALUES ($1, $2, $3, $4, 'x', $5, now() - make_interval(days => $6), current_date - ($6 - 30))
           RETURNING id`,
          [m, ids.user, dept, title, status, ageDays],
        )
      ).rows[0].id;
    };
    ids.due = await mk('Pilot branch approvals', 'decided', 31);
    ids.done = await mk('Already finished', 'done', 31);
  });

  afterAll(async () => {
    await db?.end();
    await (await import('../../src/db/pool.js')).pool.end();
    (await import('../../src/redis.js')).redis.disconnect();
  });

  it('sends one check-in (notification + email) per due decision, then moves to the next check-in', async () => {
    expect(await jobs.decisionCheckIns()).toBe(1);
    const n = await db.query(`SELECT kind, title, link FROM notifications WHERE user_id = $1 AND kind = 'decision_checkin'`, [ids.user]);
    expect(n.rows).toHaveLength(1);
    expect(n.rows[0].title).toContain('Pilot branch approvals');
    expect(n.rows[0].link).toBe(`/decisions/${ids.due}`);
    const e = await db.query(`SELECT kind, subject FROM outbound_emails WHERE kind = 'checkin'`);
    expect(e.rows).toHaveLength(1);
    const d = await db.query(`SELECT (next_check_in - decided_at::date) AS offset FROM decisions WHERE id = $1`, [ids.due]);
    expect(d.rows[0].offset).toBe(60);
    // Nothing more is due today.
    expect(await jobs.decisionCheckIns()).toBe(0);
  });

  it('stops after the last check-in', async () => {
    await db.query(`UPDATE decisions SET decided_at = now() - interval '61 days', next_check_in = current_date WHERE id = $1`, [ids.due]);
    expect(await jobs.decisionCheckIns()).toBe(1);
    const d = await db.query(`SELECT next_check_in FROM decisions WHERE id = $1`, [ids.due]);
    expect(d.rows[0].next_check_in).toBeNull();
  });
});
