/**
 * Account invites / password resets.
 *   TEST_DATABASE_URL=postgres://council:council@localhost:5433/council_acct_test TEST_REDIS_URL=redis://localhost:6380 npm test
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;

describe.skipIf(!url || !redisUrl)('account invites and resets (integration)', () => {
  let acct: typeof import('../../src/account.js');
  let db: pg.Pool;
  let userId: string;
  let outsider: string;

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
    acct = await import('../../src/account.js');
    db = new pg.Pool({ connectionString: url });
    const dept = (await db.query(`SELECT id FROM departments LIMIT 1`)).rows[0].id;
    userId = (await db.query(`INSERT INTO users (email, display_name, department_id) VALUES ('new.hire@xanderia.com.my', 'New Hire', $1) RETURNING id`, [dept])).rows[0].id;
    outsider = (await db.query(`INSERT INTO users (email, display_name, department_id) VALUES ('someone@gmail.com', 'Outsider', $1) RETURNING id`, [dept])).rows[0].id;
  });

  afterAll(async () => {
    await db?.end();
    await (await import('../../src/db/pool.js')).pool.end();
    (await import('../../src/redis.js')).redis.disconnect();
  });

  it('queues a bilingual invite email with a working link; only a hash is stored', async () => {
    const r = await acct.sendAccountLink(userId, 'invite', { id: userId, name: 'Admin' });
    const token = new URL(r.link).searchParams.get('token')!;
    expect(token.length).toBeGreaterThan(30);
    expect(r.blocked).toBe(false);
    const stored = (await db.query(`SELECT token_hash FROM password_tokens WHERE user_id = $1`, [userId])).rows;
    expect(stored.map((s) => s.token_hash)).toEqual([acct.hashToken(token)]);
    expect(JSON.stringify(stored)).not.toContain(token);
    const mail = (await db.query(`SELECT kind, to_email, status, body_text FROM outbound_emails WHERE to_email = 'new.hire@xanderia.com.my'`)).rows[0];
    expect(mail).toMatchObject({ kind: 'account', status: 'queued' });
    expect(mail.body_text).toContain(r.link);
    expect(mail.body_text).toContain('Set your password');
    expect(mail.body_text).toContain('Tetapkan kata laluan');
    expect(await acct.lookupPasswordToken(token)).toMatchObject({ user_id: userId, purpose: 'invite', email: 'new.hire@xanderia.com.my' });
  });

  it('a new link replaces the old one, links are single-use, and expired links fail', async () => {
    const first = new URL((await acct.sendAccountLink(userId, 'invite')).link).searchParams.get('token')!;
    const second = new URL((await acct.sendAccountLink(userId, 'reset')).link).searchParams.get('token')!;
    expect(await acct.lookupPasswordToken(first)).toBeNull();
    expect(await acct.lookupPasswordToken(second)).not.toBeNull();
    await db.query(`UPDATE password_tokens SET used_at = now() WHERE token_hash = $1`, [acct.hashToken(second)]);
    expect(await acct.lookupPasswordToken(second)).toBeNull();
    const third = await acct.createPasswordToken(userId, 'reset');
    await db.query(`UPDATE password_tokens SET expires_at = now() - interval '1 minute' WHERE token_hash = $1`, [acct.hashToken(third)]);
    expect(await acct.lookupPasswordToken(third)).toBeNull();
    expect(await acct.lookupPasswordToken('not-a-real-token-at-all-000000000000')).toBeNull();
  });

  it('never emails addresses outside the allowed domains, but still returns the link for the admin', async () => {
    const r = await acct.sendAccountLink(outsider, 'invite');
    expect(r.blocked).toBe(true);
    expect(r.link).toContain('/set-password?token=');
    const mail = (await db.query(`SELECT status FROM outbound_emails WHERE to_email = 'someone@gmail.com'`)).rows[0];
    expect(mail.status).toBe('blocked');
  });

  it('account emails are sent outside business hours; task emails wait', async () => {
    const svc = await import('../../src/crew/service.js');
    const { klInstant } = await import('../../src/crew/calendar.js');
    // A Saturday after today, so the emails queued just now are due (a fixed date broke once it passed).
    const d = new Date(Date.now() + 8 * 3600_000 + 86400_000);
    while (d.getUTCDay() !== 6) d.setUTCDate(d.getUTCDate() + 1);
    const n = await svc.sendQueuedEmails(klInstant(d.toISOString().slice(0, 10), 23)); // Saturday night
    expect(n).toBeGreaterThan(0);
    const statuses = (await db.query(`SELECT DISTINCT status FROM outbound_emails WHERE kind = 'account' AND to_email LIKE 'new.hire%'`)).rows.map((r) => r.status);
    expect(statuses).toEqual(['logged']);
  });
});
