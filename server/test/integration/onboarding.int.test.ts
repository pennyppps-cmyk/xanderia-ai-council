/**
 *   TEST_DATABASE_URL=postgres://council:council@localhost:5433/council_onb_test TEST_REDIS_URL=redis://localhost:6380 npm test
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;

describe.skipIf(!url || !redisUrl)('onboarding checklist (integration)', () => {
  let onb: typeof import('../../src/onboarding.js');
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
    onb = await import('../../src/onboarding.js');
    db = new pg.Pool({ connectionString: url });
    ids.fin = (await db.query(`SELECT id FROM departments WHERE slug = 'finance'`)).rows[0].id;
    ids.lead = (
      await db.query(`INSERT INTO users (email, display_name, role, department_id) VALUES ('lead@x.test', 'Fin Lead', 'dept_lead', $1) RETURNING id`, [ids.fin])
    ).rows[0].id;
  });

  afterAll(async () => {
    await db?.end();
    await (await import('../../src/db/pool.js')).pool.end();
    (await import('../../src/redis.js')).redis.disconnect();
  });

  const lead = () => ({ id: ids.lead, role: 'dept_lead', department_id: ids.fin });

  it('starts at 0 of 5 for a new lead (an empty review queue counts as clear)', async () => {
    const o = await onb.onboardingFor(lead());
    expect(o.lead).toBe(true);
    expect(o.items.map((i) => [i.key, i.done])).toEqual([
      ['rules', false],
      ['knowledge', false],
      ['review', true],
      ['council', false],
      ['decision', false],
    ]);
  });

  it('ticks steps off from what actually happened', async () => {
    for (const t of ['NPL is 90 days past due.', 'Amounts are in RM.', 'Restructured loans stay NPL for 6 months.']) {
      await db.query(`INSERT INTO house_rules (department_id, text, created_by) VALUES ($1, $2, $3)`, [ids.fin, t, ids.lead]);
    }
    await db.query(`INSERT INTO documents (department_id, title, uploaded_by) VALUES ($1, 'Credit policy', $2)`, [ids.fin, ids.lead]);
    await db.query(`INSERT INTO approved_answers (department_id, question, answer, status) VALUES ($1, 'q', 'a', 'suggested')`, [ids.fin]);
    const o = await onb.onboardingFor(lead());
    expect(Object.fromEntries(o.items.map((i) => [i.key, i.done]))).toMatchObject({ rules: true, knowledge: true, review: false });
    expect(o.done).toBe(2);
  });

  it('welcomes a new lead once, then reminds after 3 days, at most 3 times', async () => {
    expect(await onb.onboardingNudges()).toEqual({ welcomed: 1, reminded: 0 });
    expect(await onb.onboardingNudges()).toEqual({ welcomed: 0, reminded: 0 }); // not due yet
    await db.query(`UPDATE users SET created_at = now() - interval '4 days' WHERE id = $1`, [ids.lead]);
    expect(await onb.onboardingNudges()).toEqual({ welcomed: 0, reminded: 1 });
    const email = await db.query(`SELECT subject, body_text FROM outbound_emails WHERE kind = 'digest' ORDER BY created_at DESC LIMIT 1`);
    expect(email.rows[0].subject).toContain('(2/5)');
    expect(email.rows[0].body_text).toContain("Clear your department's suggested-answers queue");
    for (let i = 0; i < 4; i++) {
      await db.query(`UPDATE users SET onboarding_reminded_at = now() - interval '5 days' WHERE id = $1`, [ids.lead]);
      await onb.onboardingNudges();
    }
    expect((await db.query(`SELECT onboarding_reminders FROM users WHERE id = $1`, [ids.lead])).rows[0].onboarding_reminders).toBe(3);
  });
});
