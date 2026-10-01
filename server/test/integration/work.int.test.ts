/**
 *   TEST_DATABASE_URL=postgres://council:council@localhost:5433/council_work_test TEST_REDIS_URL=redis://localhost:6380 npm test
 */
import PizZip from 'pizzip';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;

describe.skipIf(!url || !redisUrl)('work automation (integration)', () => {
  let db: pg.Pool;
  let routines: typeof import('../../src/work/routines.js');
  let crew: typeof import('../../src/crew/service.js');
  let plans: typeof import('../../src/work/plans.js');
  let workload: typeof import('../../src/work/workload.js');
  let goals: typeof import('../../src/work/goals.js');
  let meetings: typeof import('../../src/work/meetings.js');
  let user: string;
  let dept: string;
  const people: Record<string, string> = {};

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
    routines = await import('../../src/work/routines.js');
    crew = await import('../../src/crew/service.js');
    plans = await import('../../src/work/plans.js');
    workload = await import('../../src/work/workload.js');
    goals = await import('../../src/work/goals.js');
    meetings = await import('../../src/work/meetings.js');
    db = new pg.Pool({ connectionString: url });
    ({ id: user, department_id: dept } = (await db.query(`SELECT id, department_id FROM users LIMIT 1`)).rows[0]);
    for (const [key, name, position] of [
      ['aina', 'Aina Rahman', 'Finance Executive'],
      ['farid', 'Farid Ali', 'Finance Executive'],
      ['siti', 'Siti Noor', 'Head of Collections'],
    ]) {
      people[key] = (
        await db.query(`INSERT INTO staff_directory (name, position, email, department_id) VALUES ($1, $2, $3, $4) RETURNING id`, [name, position, `${key}@xanderia.com.my`, dept])
      ).rows[0].id;
    }
  });

  afterAll(async () => {
    await db?.end();
  });

  it('runs a routine: one plan per period, due dates on working days, steps wait for their dependencies', async () => {
    const r = (
      await db.query(
        `INSERT INTO routines (name, department_id, owner_id, frequency, run_day, auto_launch) VALUES ('Month-end reconciliation', $1, $2, 'monthly', 1, true) RETURNING id`,
        [dept, user],
      )
    ).rows[0].id;
    await db.query(
      `INSERT INTO routine_steps (routine_id, seq, title, owner_type, directory_id, due_day, depends_on) VALUES
         ($1, 1, 'Download the Angkasa file', 'human', $2, 2, '{}'),
         ($1, 2, 'Reconcile the deductions', 'human', $3, 4, '{1}'),
         ($1, 3, 'Report to the Head of Collections', 'human', $4, 6, '{2}')`,
      [r, people.aina, people.farid, people.siti],
    );
    const planId = (await routines.runRoutine(r, { date: '2026-10-01' }))!;
    expect(planId).toBeTruthy();
    expect(await routines.runRoutine(r, { date: '2026-10-15' })).toBeNull(); // same month: nothing new

    const tasks = async () => (await db.query(`SELECT seq, status, approved, to_char(due_date, 'YYYY-MM-DD') AS due, directory_id FROM action_tasks WHERE plan_id = $1 ORDER BY seq`, [planId])).rows;
    let t = await tasks();
    expect(t.map((x) => x.due)).toEqual(['2026-10-02', '2026-10-06', '2026-10-08']); // 2nd, 4th, 6th working day of October
    expect(t.map((x) => x.status)).toEqual(['sent', 'draft', 'draft']); // steps 2 and 3 wait
    expect(t.every((x) => x.approved)).toBe(true);

    const id = async (seq: number) => (await db.query(`SELECT id FROM action_tasks WHERE plan_id = $1 AND seq = $2`, [planId, seq])).rows[0].id;
    await crew.applyTaskAction(await id(1), 'done', 'test');
    t = await tasks();
    expect(t.map((x) => x.status)).toEqual(['done', 'sent', 'draft']); // step 2 released, step 3 still waits
    const emails = (await db.query(`SELECT count(*)::int AS n FROM outbound_emails WHERE task_id IN (SELECT id FROM action_tasks WHERE plan_id = $1)`, [planId])).rows[0].n;
    expect(emails).toBe(2);
  });

  it('gives a new task to the backup while its owner is on leave, and hands work over', async () => {
    await db.query(`UPDATE staff_directory SET away_until = '2026-10-31', backup_id = $2 WHERE id = $1`, [people.aina, people.farid]);
    const planId = await plans.createSourcePlan({
      requesterId: user,
      departmentId: dept,
      title: 'Test data plan',
      source: 'data',
      sourceId: null,
      context: 'test',
      tasks: [{ title: 'Follow up exceptions', description: 'x', directoryId: people.aina, dueDate: '2026-10-20' }],
    });
    const t = (await db.query(`SELECT directory_id, description FROM action_tasks WHERE plan_id = $1`, [planId])).rows[0];
    expect(t.directory_id).toBe(people.farid);
    expect(t.description).toContain('Standing in for Aina Rahman');
    await db.query(`UPDATE staff_directory SET away_until = NULL WHERE id = $1`, [people.aina]);

    const before = (await workload.loadWorkload({ ids: [people.farid] }))[0];
    expect(before.open).toBe(1); // step 2 of the routine (the data plan is not launched)
    const r = await workload.handOver(people.farid, people.aina, user);
    expect(r.moved).toBe(2); // the launched routine step and the draft
    expect((await workload.loadWorkload({ ids: [people.aina] }))[0].open).toBe(1);
  });

  it('sends an approved AI draft to the person chosen for the task', async () => {
    const planId = await plans.createSourcePlan({
      requesterId: user,
      departmentId: dept,
      title: 'Draft handover plan',
      source: 'data',
      sourceId: null,
      context: 'test',
      tasks: [{ title: 'Write the SOP', description: 'Write the SOP for monthly reconciliation.', ownerType: 'agent', directoryId: people.siti, dueDate: '2026-10-20' }],
    });
    const taskId = (await db.query(`SELECT id, owner_type, directory_id FROM action_tasks WHERE plan_id = $1`, [planId])).rows[0];
    expect(taskId.owner_type).toBe('agent');
    expect(taskId.directory_id).toBe(people.siti); // the AI drafts, Siti completes
    await crew.launchPlan(planId, user, [{ id: taskId.id, approved: true, owner_type: 'agent', directory_id: people.siti }]);
    // The Runner finished its draft.
    await db.query(`UPDATE action_tasks SET status = 'review', agent_output = '# SOP\n1. Download the file.\n2. [TO FILL: owner]' WHERE id = $1`, [taskId.id]);
    const r = await crew.applyTaskAction(taskId.id, 'approve_draft', `user:${user}`);
    expect(r).toEqual({ changed: true, status: 'sent' });
    const t = (await db.query(`SELECT owner_type, status, approved FROM action_tasks WHERE id = $1`, [taskId.id])).rows[0];
    expect(t).toEqual({ owner_type: 'human', status: 'sent', approved: true });
    const mail = (await db.query(`SELECT to_email, subject, body_text FROM outbound_emails WHERE task_id = $1`, [taskId.id])).rows[0];
    expect(mail.to_email).toBe('siti@xanderia.com.my');
    expect(mail.subject).toContain('Task assigned to you: Write the SOP');
    expect(mail.body_text).toContain('Dear Siti Noor,');
    expect(mail.body_text).toContain('WHAT YOU NEED TO DO\nWrite the SOP for monthly reconciliation.');
    expect(mail.body_text).toContain('---------- DRAFT ----------');
    expect(mail.body_text).toContain('2. [TO FILL: owner]');
  });

  it('lets the requester delete a plan, stopping emails that have not gone out', async () => {
    const planId = await plans.createSourcePlan({
      requesterId: user,
      departmentId: dept,
      title: 'Plan to delete',
      source: 'data',
      sourceId: null,
      context: 'test',
      tasks: [{ title: 'Something', description: 'x', directoryId: people.aina, dueDate: '2026-10-20' }],
    });
    const task = (await db.query(`SELECT id FROM action_tasks WHERE plan_id = $1`, [planId])).rows[0].id;
    await crew.launchPlan(planId, user, [{ id: task, approved: true }]);
    const email = (await db.query(`SELECT id, status FROM outbound_emails WHERE task_id = $1`, [task])).rows[0];
    expect(email.status).toBe('queued');

    const other = (await db.query(`SELECT id FROM users WHERE id <> $1 LIMIT 1`, [user])).rows[0];
    if (other) await expect(crew.deletePlan(planId, other.id)).rejects.toThrow('Not found'); // only the requester

    expect(await crew.deletePlan(planId, user)).toEqual({ tasks: 1, emailsStopped: 1 });
    expect((await db.query(`SELECT count(*)::int AS n FROM action_plans WHERE id = $1`, [planId])).rows[0].n).toBe(0);
    expect((await db.query(`SELECT status, task_id FROM outbound_emails WHERE id = $1`, [email.id])).rows[0]).toEqual({ status: 'blocked', task_id: null });
  });

  it('lists goals with progress from the portfolio snapshot', async () => {
    await db.query(`INSERT INTO portfolio_snapshots (month, summary) VALUES ('2026-09', '{"nplRatio": 0.045, "par": {"par30": 0.12}}')`);
    await db.query(
      `INSERT INTO goals (title, quarter, department_id, owner_id, metric_source, metric, unit, baseline, target) VALUES ('Cut NPL', '2026-Q4', $1, $2, 'npl_ratio', 'NPL ratio', '%', 5, 4)`,
      [dept, user],
    );
    const list = await goals.listGoals({ id: user, role: 'admin', department_id: dept }, '2026-Q4');
    expect(list[0].current).toBe(4.5);
    expect(list[0].metric_progress).toBe(50);
  });

  it('writes the minutes on the letterhead', async () => {
    const m = (
      await db.query(
        `INSERT INTO meetings (title, held_on, attendees, notes, minutes, status, created_by) VALUES ('Collections weekly', '2026-10-05', $1, 'notes', $2, 'minuted', $3) RETURNING id`,
        [[people.aina], JSON.stringify({ summary: 'Reviewed arrears.', decisions: ['Start the SMS pilot'], actions: [{ task: 'Pick the pilot branches', owner: 'Aina', directory_id: people.aina, due_date: '2026-10-09' }], open_points: [] }), user],
      )
    ).rows[0].id;
    const doc = new PizZip(await meetings.minutesDocx(m)).file('word/document.xml')!.asText();
    expect(doc).toContain('MINUTES OF MEETING');
    expect(doc).toContain('Pick the pilot branches');
    expect(doc).toContain('Aina Rahman');
    expect(doc).toContain('9 October 2026');
  });
});
