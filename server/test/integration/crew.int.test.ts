/**
 * Acceptance (HANDOFF §14.8): no email leaves without requester approval; email links update
 * the task; emails contain no IC/account numbers. Runs against real Postgres + Redis:
 *   TEST_DATABASE_URL=postgres://council:council@localhost:5433/council_crew_test \
 *   TEST_REDIS_URL=redis://localhost:6380 npm test
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;

describe.skipIf(!url || !redisUrl)('Action Crew (integration)', () => {
  let svc: typeof import('../../src/crew/service.js');
  let db: pg.Pool;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const adminClient = new pg.Client({ connectionString: url!.replace(/\/[^/]+$/, '/postgres') });
    await adminClient.connect();
    const name = new URL(url!).pathname.slice(1);
    await adminClient.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await adminClient.query(`CREATE DATABASE ${name}`);
    await adminClient.end();
    // Point the app modules at the test database before they are imported.
    process.env.DATABASE_URL = url;
    process.env.REDIS_URL = redisUrl;
    const { migrate } = await import('../../src/db/migrate.js');
    await migrate(url!, () => {});
    const { seed } = await import('../../src/db/seed.js');
    await seed(() => {});
    svc = await import('../../src/crew/service.js');
    db = new pg.Pool({ connectionString: url });

    const dept = (await db.query(`SELECT id FROM departments WHERE slug = 'credit-collections'`)).rows[0].id;
    ids.user = (await db.query(`SELECT id FROM users LIMIT 1`)).rows[0].id;
    ids.conv = (await db.query(`INSERT INTO conversations (user_id, department_id, title) VALUES ($1, $2, 'Pilot') RETURNING id`, [ids.user, dept])).rows[0].id;
    const q = (await db.query(`INSERT INTO messages (conversation_id, role, content) VALUES ($1, 'user', 'q') RETURNING id`, [ids.conv])).rows[0].id;
    ids.msg = (
      await db.query(
        `INSERT INTO messages (conversation_id, role, reply_to, mode, department_id, status, content, verdict)
         VALUES ($1, 'assistant', $2, 'council', $3, 'done', 'v', $4) RETURNING id`,
        [ids.conv, q, dept, JSON.stringify({ verdict: 'Pilot in two branches', action_plan: [] })],
      )
    ).rows[0].id;
    ids.ain = (await db.query(`INSERT INTO staff_directory (name, position, email, manager_email) VALUES ('Nur Ain', 'Collections Manager', 'ain@xanderia.com.my', 'boss@xanderia.com.my') RETURNING id`)).rows[0].id;
    ids.ext = (await db.query(`INSERT INTO staff_directory (name, position, email) VALUES ('Vendor', 'Consultant', 'someone@gmail.com') RETURNING id`)).rows[0].id;

    // A plan as the Dispatcher would leave it (model calls are covered by unit tests).
    const plan = await svc.createPlan(ids.msg, ids.user);
    ids.plan = plan.id;
    await db.query(`UPDATE action_plans SET status = 'ready' WHERE id = $1`, [ids.plan]);
    const mk = async (seq: number, dirId: string | null, body: string) =>
      (
        await db.query(
          `INSERT INTO action_tasks (plan_id, seq, title, description, owner_type, owner_role, directory_id, resolution, due_date, email_body)
           VALUES ($1, $2, $3, 'desc', 'human', 'Collections Manager', $4, 'resolved', current_date + 5, $5) RETURNING id`,
          [ids.plan, seq, `Task ${seq}`, dirId, body],
        )
      ).rows[0].id;
    ids.t1 = await mk(1, ids.ain, 'Please call the borrower, IC 880212-10-5566, account 1234 5678 9012.');
    ids.t2 = await mk(2, ids.ain, 'Second task');
    ids.t3 = await mk(3, ids.ext, 'External');
    ids.t4 = await mk(4, null, 'Nobody yet');
  });

  afterAll(async () => {
    await db?.end();
    const { pool } = await import('../../src/db/pool.js');
    await pool.end();
    const { redis } = await import('../../src/redis.js');
    redis.disconnect();
  });

  const emailCount = async () => Number((await db.query(`SELECT count(*) FROM outbound_emails`)).rows[0].count);

  it('refuses to queue an email for an unapproved task', async () => {
    await expect(svc.queueTaskEmail(ids.t1, 'task')).rejects.toThrow(/not been approved/);
    expect(await emailCount()).toBe(0);
  });

  it('refuses to approve a human task without an owner from the directory', async () => {
    await expect(svc.launchPlan(ids.plan, ids.user, [{ id: ids.t4, approved: true }])).rejects.toThrow(/needs an owner/);
    expect(await emailCount()).toBe(0);
  });

  it('queues emails only for approved tasks; the rest stay drafts', async () => {
    const r = await svc.launchPlan(ids.plan, ids.user, [
      { id: ids.t1, approved: true },
      { id: ids.t2, approved: false },
    ]);
    expect(r.queued).toBe(1);
    const { rows } = await db.query(`SELECT task_id, to_email, body_text, body_html, subject FROM outbound_emails`);
    expect(rows).toHaveLength(1);
    expect(rows[0].task_id).toBe(ids.t1);
    expect(rows[0].to_email).toBe('ain@xanderia.com.my');
    const all = rows.map((e) => e.subject + e.body_text + e.body_html).join('\n');
    expect(all).not.toMatch(/\d{6}[\s-]?\d{2}[\s-]?\d{4}/);
    expect(all).not.toMatch(/\d(?:[\s-]?\d){7,}/);
    const t2 = (await db.query(`SELECT status FROM action_tasks WHERE id = $1`, [ids.t2])).rows[0];
    expect(t2.status).toBe('draft');
  });

  it('blocks recipients outside the internal domain allowlist', async () => {
    const r = await svc.launchPlan(ids.plan, ids.user, [{ id: ids.t3, approved: true }]);
    expect(r.blocked).toBe(1);
    const e = (await db.query(`SELECT status FROM outbound_emails WHERE task_id = $1`, [ids.t3])).rows[0];
    expect(e.status).toBe('blocked');
  });

  it('an email-link action updates the task and notifies the requester', async () => {
    const accepted = await svc.applyTaskAction(ids.t1, 'accept', 'email-link');
    expect(accepted).toEqual({ changed: true, status: 'accepted' });
    const again = await svc.applyTaskAction(ids.t1, 'accept', 'email-link');
    expect(again.changed).toBe(false);
    const done = await svc.applyTaskAction(ids.t1, 'done', 'email-link');
    expect(done.status).toBe('done');
    const n = await db.query(`SELECT kind FROM notifications WHERE user_id = $1 ORDER BY created_at`, [ids.user]);
    expect(n.rows.map((r) => r.kind)).toEqual(expect.arrayContaining(['task_accept', 'task_done']));
  });

  it('escalation needs requester approval and goes to the manager', async () => {
    await db.query(`UPDATE action_tasks SET escalation_state = 'pending', status = 'in_progress', approved = true WHERE id = $1`, [ids.t2]);
    const before = await emailCount();
    await svc.decideEscalation(ids.t2, ids.user, false);
    expect(await emailCount()).toBe(before);
    await db.query(`UPDATE action_tasks SET escalation_state = 'pending' WHERE id = $1`, [ids.t2]);
    await svc.decideEscalation(ids.t2, ids.user, true);
    const e = (await db.query(`SELECT to_email, kind FROM outbound_emails WHERE task_id = $1 AND kind = 'escalation'`, [ids.t2])).rows[0];
    expect(e).toEqual({ to_email: 'boss@xanderia.com.my', kind: 'escalation' });
  });

  it('the sender delivers queued emails only in business hours, via the outbox provider by default', async () => {
    const { klInstant } = await import('../../src/crew/calendar.js');
    await db.query(`UPDATE outbound_emails SET send_after = now() - interval '1 day' WHERE status = 'queued'`);
    // A weekend after today: fixed dates stopped working once they were in the past.
    const sat = new Date(Date.now() + 8 * 3600_000 + 86400_000);
    while (sat.getUTCDay() !== 6) sat.setUTCDate(sat.getUTCDate() + 1);
    const day = (offset: number) => new Date(sat.getTime() + offset * 86400_000).toISOString().slice(0, 10);
    expect(await svc.sendQueuedEmails(klInstant(day(0), 10))).toBe(0); // Saturday
    const monday = klInstant(day(2), 10);
    const n = await svc.sendQueuedEmails(monday);
    expect(n).toBeGreaterThan(0);
    const statuses = (await db.query(`SELECT DISTINCT status FROM outbound_emails WHERE status <> 'blocked'`)).rows.map((r) => r.status);
    expect(statuses).toEqual(['logged']);
  });
});
