import { writeAudit } from '../audit.js';
import { config } from '../config.js';
import { query, tx } from '../db/pool.js';
import { PRIORITY } from '../llm/gate.js';
import { gateway } from '../llm/registry.js';
import { DispatchSchema, type Verdict } from '../llm/schemas.js';
import { callStructured } from '../llm/structured.js';
import { assemblePrompt } from '../prompts/assembler.js';
import { createPublisher } from '../queue/events.js';
import { redis } from '../redis.js';
import { getSetting } from '../settings.js';
import { addWorkingDays, DEFAULT_CALENDAR, isBusinessHours, klParts, nextBusinessMoment, type WorkCalendar } from './calendar.js';
import { allowedRecipient, buildTaskEmail, scrubEmailText } from './email.js';
import { getMailProvider } from './mailer.js';
import { resolveOwner, type DirectoryEntry } from './resolve.js';
import { signTaskToken } from './tokens.js';
import { DEFAULT_TIMINGS, trackerActions, type TrackerTimings } from './tracker.js';

const events = createPublisher(redis);

export class CrewError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

// ── Settings ─────────────────────────────────────────────────────────────────

export async function loadCalendar(): Promise<WorkCalendar> {
  const [{ rows }, hours, weekend] = await Promise.all([
    query(`SELECT to_char(date, 'YYYY-MM-DD') AS d FROM holidays`),
    getSetting('crew_business_hours', { start: 9, end: 18 }),
    getSetting('crew_weekend', DEFAULT_CALENDAR.weekend),
  ]);
  return { holidays: new Set(rows.map((r) => r.d)), weekend, startHour: hours.start, endHour: hours.end };
}

export const loadTimings = () => getSetting<TrackerTimings>('crew_timings', DEFAULT_TIMINGS);
const emailDomains = () => getSetting<string[]>('crew_email_domains', ['xanderia.com.my']);

// ── Helpers ──────────────────────────────────────────────────────────────────

async function taskEvent(taskId: string, kind: string, actor: string, detail: Record<string, unknown> = {}) {
  await query(`INSERT INTO task_events (task_id, kind, actor, detail) VALUES ($1, $2, $3, $4)`, [taskId, kind, actor, JSON.stringify(detail)]);
}

export async function notify(userId: string, n: { kind: string; title: string; body?: string; link?: string; taskId?: string }) {
  await query(
    `INSERT INTO notifications (user_id, kind, title, body, link, task_id) VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, n.kind, n.title, n.body ?? null, n.link ?? null, n.taskId ?? null],
  );
  await events.notifyUser(userId, { type: 'notification', kind: n.kind, title: n.title, link: n.link });
}

function links(taskId: string) {
  const token = signTaskToken(taskId, config.JWT_SECRET);
  const base = `${config.APP_BASE_URL.replace(/\/+$/, '')}/api/t/${token}`;
  return {
    accept: `${base}?a=accept`,
    help: `${base}?a=help`,
    done: `${base}?a=done`,
    cant: `${base}?a=cant`,
    open: `${config.APP_BASE_URL.replace(/\/+$/, '')}/tasks`,
  };
}

async function loadDirectory(): Promise<DirectoryEntry[]> {
  const { rows } = await query(
    `SELECT id, name, position, email, department_id, manager_email FROM staff_directory WHERE is_active ORDER BY name`,
  );
  return rows;
}

async function maybeCompletePlan(planId: string) {
  const { rows } = await query(
    `SELECT count(*) FILTER (WHERE status NOT IN ('done', 'cancelled'))::int AS open, count(*)::int AS total
       FROM action_tasks WHERE plan_id = $1`,
    [planId],
  );
  if (rows[0].total > 0 && rows[0].open === 0) {
    await query(`UPDATE action_plans SET status = 'done' WHERE id = $1 AND status = 'launched'`, [planId]);
  }
}

// ── 1. Plan creation + Dispatcher ────────────────────────────────────────────

export async function createPlan(messageId: string, userId: string) {
  const { rows } = await query(
    `SELECT m.id, m.conversation_id, m.department_id, m.verdict, m.mode, m.status, c.title
       FROM messages m JOIN conversations c ON c.id = m.conversation_id
      WHERE m.id = $1 AND c.user_id = $2`,
    [messageId, userId],
  );
  const m = rows[0];
  if (!m) throw new CrewError('Not found', 404);
  if (m.mode !== 'council' || m.status !== 'done' || !m.verdict) {
    throw new CrewError('Only a finished council verdict can be put into action');
  }
  const existing = await query(`SELECT id, status FROM action_plans WHERE message_id = $1`, [messageId]);
  if (existing.rows[0]) {
    if (existing.rows[0].status !== 'error') return { id: existing.rows[0].id as string, created: false };
    await query(`DELETE FROM action_plans WHERE id = $1`, [existing.rows[0].id]); // retry a failed dispatch
  }
  const title = (m.verdict as Verdict).verdict.slice(0, 140);
  const { rows: plan } = await query(
    `INSERT INTO action_plans (message_id, conversation_id, requester_id, department_id, title)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [messageId, m.conversation_id, userId, m.department_id, title],
  );
  await writeAudit({ actorUserId: userId, action: 'action_plan_created', targetType: 'action_plan', targetId: plan[0].id, detail: { message_id: messageId } });
  return { id: plan[0].id as string, created: true };
}

export async function dispatchPlan(planId: string) {
  const { rows } = await query(
    `SELECT p.*, m.verdict, m.router, COALESCE(m.options->>'effectiveQuestion', q.content) AS question,
            u.display_name AS requester_name, d.name AS dept_name
       FROM action_plans p
       JOIN messages m ON m.id = p.message_id
       JOIN messages q ON q.id = m.reply_to
       JOIN users u ON u.id = p.requester_id
       LEFT JOIN departments d ON d.id = p.department_id
      WHERE p.id = $1`,
    [planId],
  );
  const plan = rows[0];
  if (!plan || plan.status !== 'planning') return;
  const verdict = plan.verdict as Verdict;
  const language = plan.router?.language === 'ms' ? 'Bahasa Malaysia' : 'English';

  try {
    const directory = await loadDirectory();
    const positions = [...new Set(directory.map((d) => d.position))].slice(0, 80);
    const system = await assemblePrompt({ task: 'crew_dispatcher' });
    const res = await callStructured(
      gateway,
      'crew:dispatcher',
      [
        { role: 'system', content: system },
        {
          role: 'user',
          content: [
            `Decision (Chairman's verdict): ${verdict.verdict}`,
            `Department: ${plan.dept_name ?? 'n/a'}`,
            'Action plan from the council:',
            ...verdict.action_plan.map((s, i) => `${i + 1}. ${s.step} (owner: ${s.owner_role}; ${s.timeline})`),
            '',
            positions.length
              ? `Positions in the staff directory (use these for owner_role when one fits):\n${positions.map((p) => `- ${p}`).join('\n')}`
              : 'The staff directory is empty; use clear job titles for owner_role.',
          ].join('\n'),
        },
      ],
      DispatchSchema,
      { userId: plan.requester_id, sensitivity: 'high', priority: PRIORITY.background, purpose: 'crew:dispatcher' },
    );
    if (!res.ok) throw new Error(`Dispatcher output was not valid: ${res.error}`);

    const cal = await loadCalendar();
    const today = klParts(new Date()).date;
    const tasks = res.data.tasks.slice(0, 12);
    const inserted: Array<{ id: string; title: string; description: string; owner: DirectoryEntry | null; dueDate: string }> = [];

    await tx(async (c) => {
      for (const [i, t] of tasks.entries()) {
        const seq = i + 1;
        const isAgent = t.owner_type === 'agent';
        const r = isAgent ? null : resolveOwner(t.owner_role, directory, plan.department_id);
        const dueDate = addWorkingDays(today, t.due_in_working_days, cal);
        const deps = t.depends_on.filter((d) => d >= 1 && d < seq);
        const { rows: ins } = await c.query(
          `INSERT INTO action_tasks (plan_id, seq, title, description, owner_type, owner_role, directory_id,
                                     resolution, candidates, depends_on, due_date)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
          [
            planId,
            seq,
            scrubEmailText(t.title).slice(0, 200),
            scrubEmailText(t.description).slice(0, 1000),
            t.owner_type,
            isAgent ? 'AI Runner' : t.owner_role.slice(0, 120),
            r?.directoryId ?? null,
            isAgent ? 'agent' : r!.resolution,
            JSON.stringify((r?.candidates ?? []).map((d) => ({ id: d.id, name: d.name, position: d.position, email: d.email }))),
            deps,
            dueDate,
          ],
        );
        const owner = r?.directoryId ? directory.find((d) => d.id === r.directoryId)! : null;
        if (!isAgent) inserted.push({ id: ins[0].id, title: t.title, description: t.description, owner, dueDate });
      }
    });

    // Herald drafts one email body per human task (never sent before approval).
    for (const t of inserted) {
      const body = await draftEmailBody({
        title: t.title,
        description: t.description,
        why: verdict.verdict,
        dueDate: t.dueDate,
        ownerPosition: t.owner?.position ?? null,
        language,
        userId: plan.requester_id,
      });
      await query(`UPDATE action_tasks SET email_subject = $2, email_body = $3 WHERE id = $1`, [
        t.id,
        `[Xanderia AI Council] Task for you: ${scrubEmailText(t.title)}`,
        body,
      ]);
    }

    await query(`UPDATE action_plans SET status = 'ready' WHERE id = $1`, [planId]);
    await notify(plan.requester_id, {
      kind: 'plan_ready',
      title: 'Your action plan is ready for review',
      body: `${tasks.length} tasks planned. Nothing is sent until you approve.`,
      link: `/plans/${planId}`,
    });
  } catch (err) {
    await query(`UPDATE action_plans SET status = 'error', error = $2 WHERE id = $1`, [planId, (err as Error).message]);
    await events.notifyUser(plan.requester_id, { type: 'notification', kind: 'plan_error', title: 'Planning failed', link: `/plans/${planId}` });
  }
}

async function draftEmailBody(i: {
  title: string;
  description: string;
  why: string;
  dueDate: string;
  ownerPosition: string | null;
  language: string;
  userId: string;
}) {
  const fallback = `You have been asked to take on this task: ${i.title}.\n\n${i.description}\n\nIt is part of a plan agreed through the Xanderia AI Council. Please confirm with the buttons below whether you can take it on.`;
  try {
    const system = await assemblePrompt({ task: 'crew_herald' });
    const out = await gateway.call(
      'crew:herald',
      [
        { role: 'system', content: system },
        {
          role: 'user',
          content: `Language: ${i.language}\nRecipient's position: ${i.ownerPosition ?? 'colleague'}\nTask: ${i.title}\nWhat done looks like: ${i.description}\nWhy it matters (context): ${i.why}\nDue: ${i.dueDate}`,
        },
      ],
      { userId: i.userId, sensitivity: 'high', priority: PRIORITY.background, purpose: 'crew:herald' },
    );
    const body = scrubEmailText(out.content.replace(/^(subject|hi|dear|hello)[^\n]*\n+/i, '').trim());
    return body.length >= 20 ? body.slice(0, 1500) : fallback;
  } catch {
    return fallback;
  }
}

// ── 2. Launch (approval) ─────────────────────────────────────────────────────

export interface TaskEdit {
  id: string;
  approved: boolean;
  directory_id?: string | null;
  due_date?: string | null;
  email_body?: string;
  owner_type?: 'human' | 'agent';
}

/** Queue an email for a task. Refuses anything the requester has not approved (HANDOFF §14.6). */
export async function queueTaskEmail(taskId: string, kind: 'task' | 'reminder' | 'escalation', opts: { to?: string } = {}) {
  const { rows } = await query(
    `SELECT t.*, s.name AS owner_name, s.email AS owner_email, s.manager_email,
            p.title AS plan_title, u.display_name AS requester_name
       FROM action_tasks t
       JOIN action_plans p ON p.id = t.plan_id
       JOIN users u ON u.id = p.requester_id
       LEFT JOIN staff_directory s ON s.id = t.directory_id
      WHERE t.id = $1`,
    [taskId],
  );
  const t = rows[0];
  if (!t) throw new CrewError('Task not found', 404);
  if (!t.approved) throw new CrewError('This task has not been approved by the requester; nothing is sent without approval');
  if (t.owner_type !== 'human' || !t.owner_email) throw new CrewError('Task has no owner from the staff directory');

  const to = kind === 'escalation' ? opts.to ?? t.manager_email : t.owner_email;
  if (!to) throw new CrewError('No recipient email');
  const email = buildTaskEmail({
    kind,
    ownerName: kind === 'escalation' ? 'there' : t.owner_name.split(' ')[0],
    assigneeName: kind === 'escalation' ? t.owner_name : undefined,
    title: t.title,
    body:
      kind === 'task'
        ? t.email_body ?? t.description
        : kind === 'reminder'
          ? `A friendly reminder about this task${t.acknowledged_at ? '' : ', which has not been acknowledged yet'}. ${t.description}`
          : `This task assigned to ${t.owner_name} is overdue and has not been completed. ${t.requester_name} asked the Council to raise it with you as their manager.`,
    dueDate: t.due_date ? new Date(t.due_date).toISOString().slice(0, 10) : null,
    requesterName: t.requester_name,
    planTitle: t.plan_title,
    links: links(taskId),
  });
  const domains = await emailDomains();
  const blocked = !allowedRecipient(to, domains);
  const sendAfter = nextBusinessMoment(new Date(), await loadCalendar());
  await query(
    `INSERT INTO outbound_emails (task_id, kind, to_email, subject, body_text, body_html, status, error, send_after)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [taskId, kind, to, email.subject, email.text, email.html, blocked ? 'blocked' : 'queued', blocked ? `Recipient domain not in allowlist (${domains.join(', ')})` : null, sendAfter],
  );
  await taskEvent(taskId, blocked ? 'email_blocked' : 'email_queued', 'herald', { kind, to });
  return { blocked, sendAfter };
}

export async function launchPlan(planId: string, userId: string, edits: TaskEdit[]) {
  const { rows: plans } = await query(`SELECT * FROM action_plans WHERE id = $1 AND requester_id = $2`, [planId, userId]);
  const plan = plans[0];
  if (!plan) throw new CrewError('Not found', 404);
  if (plan.status !== 'ready' && plan.status !== 'launched') throw new CrewError(`Plan is ${plan.status}`);

  const directory = new Map((await loadDirectory()).map((d) => [d.id, d]));
  const { rows: tasks } = await query(`SELECT * FROM action_tasks WHERE plan_id = $1 ORDER BY seq`, [planId]);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const toEmail: string[] = [];
  const toRun: string[] = [];

  await tx(async (c) => {
    for (const e of edits) {
      const t = byId.get(e.id);
      if (!t || t.status !== 'draft') continue; // already launched tasks are not re-sent
      const ownerType = e.owner_type ?? t.owner_type;
      let directoryId = e.directory_id === undefined ? t.directory_id : e.directory_id;
      if (directoryId && !directory.has(directoryId)) throw new CrewError('Owner must be chosen from the staff directory');
      if (ownerType === 'agent') directoryId = null;
      if (e.approved && ownerType === 'human' && !directoryId) {
        throw new CrewError(`Task ${t.seq} "${t.title}" needs an owner before it can be approved`);
      }
      await c.query(
        `UPDATE action_tasks SET approved = $2, directory_id = $3, owner_type = $4,
                resolution = CASE WHEN $4 = 'agent' THEN 'agent' WHEN $3::uuid IS NOT NULL THEN 'resolved' ELSE resolution END,
                due_date = COALESCE($5::date, due_date), email_body = COALESCE($6, email_body), updated_at = now()
          WHERE id = $1`,
        [t.id, e.approved, directoryId, ownerType, e.due_date ?? null, e.email_body !== undefined ? scrubEmailText(e.email_body) : null],
      );
      if (e.approved) (ownerType === 'agent' ? toRun : toEmail).push(t.id);
    }
  });

  let queued = 0;
  let blocked = 0;
  for (const id of toEmail) {
    const r = await queueTaskEmail(id, 'task');
    await query(`UPDATE action_tasks SET status = $2, sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END WHERE id = $1`, [
      id,
      r.blocked ? 'blocked' : 'sent',
    ]);
    r.blocked ? blocked++ : queued++;
  }
  for (const id of toRun) {
    await query(`UPDATE action_tasks SET status = 'running' WHERE id = $1`, [id]);
    await taskEvent(id, 'runner_queued', 'runner');
  }
  if (toEmail.length || toRun.length) {
    await query(`UPDATE action_plans SET status = 'launched', launched_at = COALESCE(launched_at, now()) WHERE id = $1`, [planId]);
  }
  await writeAudit({
    actorUserId: userId,
    action: 'action_plan_launched',
    targetType: 'action_plan',
    targetId: planId,
    detail: { emails_queued: queued, emails_blocked: blocked, agent_tasks: toRun.length },
  });
  return { queued, blocked, agentTasks: toRun };
}

// ── 3. Status changes (email links and in-app) ───────────────────────────────

export type TaskAction = 'accept' | 'start' | 'help' | 'done' | 'cant' | 'cancel' | 'approve_draft';

const TRANSITIONS: Record<TaskAction, { from: string[]; to: string | null }> = {
  accept: { from: ['sent', 'blocked'], to: 'accepted' },
  start: { from: ['sent', 'accepted', 'blocked'], to: 'in_progress' },
  help: { from: ['sent', 'accepted', 'in_progress'], to: 'blocked' },
  done: { from: ['sent', 'accepted', 'in_progress', 'blocked'], to: 'done' },
  cant: { from: ['sent', 'accepted', 'in_progress', 'blocked'], to: 'cant_do' },
  cancel: { from: ['draft', 'sent', 'accepted', 'in_progress', 'blocked', 'review', 'cant_do'], to: 'cancelled' },
  approve_draft: { from: ['review'], to: 'done' },
};

export function nextStatus(current: string, action: TaskAction): string | null {
  const t = TRANSITIONS[action];
  return t.from.includes(current) ? t.to : null;
}

export async function applyTaskAction(taskId: string, action: TaskAction, actor: string, note?: string) {
  const { rows } = await query(
    `SELECT t.*, p.requester_id, p.id AS plan_id, s.name AS owner_name
       FROM action_tasks t JOIN action_plans p ON p.id = t.plan_id
       LEFT JOIN staff_directory s ON s.id = t.directory_id WHERE t.id = $1`,
    [taskId],
  );
  const t = rows[0];
  if (!t) throw new CrewError('Task not found', 404);
  const to = nextStatus(t.status, action);
  if (!to) return { changed: false, status: t.status as string };

  await query(
    `UPDATE action_tasks SET status = $2, response_note = COALESCE($3, response_note), updated_at = now(),
            acknowledged_at = CASE WHEN acknowledged_at IS NULL AND $4 THEN now() ELSE acknowledged_at END,
            completed_at = CASE WHEN $2 = 'done' THEN now() ELSE completed_at END
      WHERE id = $1`,
    [taskId, to, note?.slice(0, 1000) ?? null, action !== 'cancel'],
  );
  await taskEvent(taskId, `status:${to}`, actor, note ? { note } : {});
  await writeAudit({ action: 'task_status_changed', targetType: 'action_task', targetId: taskId, detail: { from: t.status, to, actor } });

  const who = t.owner_name ?? 'The owner';
  const messages: Partial<Record<TaskAction, string>> = {
    accept: `${who} accepted "${t.title}"`,
    help: `${who} needs help with "${t.title}"`,
    done: `${who} marked "${t.title}" as done`,
    cant: `${who} can't do "${t.title}"; reassign it?`,
  };
  if (messages[action] && !actor.startsWith('user:' + t.requester_id)) {
    await notify(t.requester_id, { kind: `task_${action}`, title: messages[action]!, body: note, link: `/plans/${t.plan_id}`, taskId });
  }
  await maybeCompletePlan(t.plan_id);
  return { changed: true, status: to };
}

// ── 4. Tracker ───────────────────────────────────────────────────────────────

export async function trackerTick(now = new Date()) {
  const cal = await loadCalendar();
  const timings = await loadTimings();
  const { rows } = await query(
    `SELECT t.*, to_char(t.due_date, 'YYYY-MM-DD') AS due, p.requester_id, p.id AS plan_id,
            s.name AS owner_name, (s.manager_email IS NOT NULL AND s.manager_email <> '') AS has_manager
       FROM action_tasks t JOIN action_plans p ON p.id = t.plan_id
       LEFT JOIN staff_directory s ON s.id = t.directory_id
      WHERE p.status = 'launched' AND t.owner_type = 'human'
        AND t.status IN ('sent', 'accepted', 'in_progress', 'blocked')`,
  );
  let count = 0;
  for (const t of rows) {
    const actions = trackerActions({ ...t, due_date: t.due }, now, cal, timings);
    for (const a of actions) {
      count++;
      if (a === 'ack_reminder' || a === 'due_reminder') {
        await queueTaskEmail(t.id, 'reminder');
        await query(`UPDATE action_tasks SET ${a === 'ack_reminder' ? 'ack_reminded_at' : 'due_reminded_at'} = now() WHERE id = $1`, [t.id]);
      } else if (a === 'nudge_requester') {
        await query(`UPDATE action_tasks SET nudged_at = now() WHERE id = $1`, [t.id]);
        await notify(t.requester_id, {
          kind: 'task_overdue',
          title: `${t.owner_name ?? 'The owner'} hasn't finished "${t.title}"`,
          body: 'It is past its due date. Send a follow-up, snooze it or reassign it.',
          link: `/plans/${t.plan_id}`,
          taskId: t.id,
        });
        await taskEvent(t.id, 'requester_nudged', 'tracker');
      } else if (a === 'propose_escalation') {
        await query(`UPDATE action_tasks SET escalation_state = 'pending' WHERE id = $1`, [t.id]);
        await notify(t.requester_id, {
          kind: 'escalation_pending',
          title: `Escalate "${t.title}" to ${t.owner_name ?? 'the owner'}'s manager?`,
          body: `It is ${timings.escalateAfterDays}+ working days overdue. Nothing is sent unless you approve.`,
          link: `/plans/${t.plan_id}`,
          taskId: t.id,
        });
        await taskEvent(t.id, 'escalation_proposed', 'tracker');
      }
    }
  }
  return count;
}

export async function decideEscalation(taskId: string, userId: string, approve: boolean) {
  const { rows } = await query(
    `SELECT t.id, t.escalation_state FROM action_tasks t JOIN action_plans p ON p.id = t.plan_id
      WHERE t.id = $1 AND p.requester_id = $2`,
    [taskId, userId],
  );
  if (!rows[0]) throw new CrewError('Not found', 404);
  if (rows[0].escalation_state !== 'pending') throw new CrewError('No escalation is waiting for approval');
  if (approve) await queueTaskEmail(taskId, 'escalation');
  await query(`UPDATE action_tasks SET escalation_state = $2, escalated_at = CASE WHEN $3 THEN now() END WHERE id = $1`, [
    taskId,
    approve ? 'sent' : 'declined',
    approve,
  ]);
  await taskEvent(taskId, approve ? 'escalation_sent' : 'escalation_declined', `user:${userId}`);
  await writeAudit({ actorUserId: userId, action: approve ? 'task_escalated' : 'task_escalation_declined', targetType: 'action_task', targetId: taskId, detail: {} });
}

/** Requester follow-up: send a reminder now (still within business hours) or snooze the Tracker. */
export async function followUp(taskId: string, userId: string, kind: 'remind' | 'snooze') {
  const { rows } = await query(
    `SELECT t.id FROM action_tasks t JOIN action_plans p ON p.id = t.plan_id WHERE t.id = $1 AND p.requester_id = $2`,
    [taskId, userId],
  );
  if (!rows[0]) throw new CrewError('Not found', 404);
  if (kind === 'remind') {
    await queueTaskEmail(taskId, 'reminder');
  } else {
    const cal = await loadCalendar();
    const until = addWorkingDays(klParts(new Date()).date, 2, cal);
    await query(`UPDATE action_tasks SET snoozed_until = $2::date, nudged_at = NULL WHERE id = $1`, [taskId, until]);
  }
  await taskEvent(taskId, kind === 'remind' ? 'follow_up_sent' : 'snoozed', `user:${userId}`);
}

// ── 5. Sending (outbox → provider) ───────────────────────────────────────────

export async function sendQueuedEmails(now = new Date()) {
  const cal = await loadCalendar();
  if (!isBusinessHours(now, cal)) return 0; // no emails outside business hours
  const provider = getMailProvider();
  const domains = await emailDomains();
  const { rows } = await query(
    `SELECT * FROM outbound_emails WHERE status = 'queued' AND send_after <= $1 ORDER BY created_at LIMIT 25`,
    [now],
  );
  for (const e of rows) {
    if (!allowedRecipient(e.to_email, domains)) {
      await query(`UPDATE outbound_emails SET status = 'blocked', error = 'Recipient domain not in allowlist' WHERE id = $1`, [e.id]);
      continue;
    }
    try {
      const result = await provider.send({ to: e.to_email, subject: e.subject, text: e.body_text, html: e.body_html });
      await query(`UPDATE outbound_emails SET status = $2, provider = $3, sent_at = now(), error = NULL WHERE id = $1`, [e.id, result, provider.id]);
      await writeAudit({ action: 'email_sent', targetType: 'outbound_email', targetId: e.id, detail: { kind: e.kind, to: e.to_email, provider: provider.id, result } });
    } catch (err) {
      await query(`UPDATE outbound_emails SET status = 'failed', provider = $3, error = $2 WHERE id = $1`, [e.id, (err as Error).message, provider.id]);
    }
  }
  return rows.length;
}

// ── 6. Runner (agent tasks) ──────────────────────────────────────────────────

export async function runAgentTask(taskId: string) {
  const { rows } = await query(
    `SELECT t.*, p.requester_id, p.id AS plan_id, m.verdict
       FROM action_tasks t JOIN action_plans p ON p.id = t.plan_id JOIN messages m ON m.id = p.message_id
      WHERE t.id = $1`,
    [taskId],
  );
  const t = rows[0];
  if (!t || t.status !== 'running') return;
  try {
    const system = await assemblePrompt({ task: 'crew_runner' });
    const out = await gateway.call(
      'crew:runner',
      [
        { role: 'system', content: system },
        {
          role: 'user',
          content: `Deliverable: ${t.title}\nWhat done looks like: ${t.description}\n\nContext, the council's decision: ${(t.verdict as Verdict).verdict}`,
        },
      ],
      { userId: t.requester_id, sensitivity: 'high', priority: PRIORITY.background, purpose: 'crew:runner' },
    );
    await query(`UPDATE action_tasks SET status = 'review', agent_output = $2, updated_at = now() WHERE id = $1`, [taskId, out.content.trim()]);
    await taskEvent(taskId, 'draft_ready', 'runner');
    await notify(t.requester_id, { kind: 'draft_ready', title: `Draft ready for review: "${t.title}"`, link: `/plans/${t.plan_id}`, taskId });
  } catch (err) {
    await query(`UPDATE action_tasks SET status = 'blocked', response_note = $2 WHERE id = $1`, [taskId, `Runner failed: ${(err as Error).message}`]);
  }
}

// ── 7. Crew panel ────────────────────────────────────────────────────────────

export async function crewStatus(userId: string) {
  const names = await getSetting('crew_names', { dispatcher: 'Dispatcher', herald: 'Herald', tracker: 'Tracker', runner: 'Runner' });
  const { rows } = await query(
    `SELECT
       count(*) FILTER (WHERE p.status = 'planning')::int AS planning,
       count(t.id) FILTER (WHERE p.status = 'ready')::int AS planned,
       count(t.id) FILTER (WHERE t.status = 'draft' AND t.owner_type = 'human' AND p.status IN ('ready', 'launched'))::int AS awaiting_approval,
       count(t.id) FILTER (WHERE t.status IN ('sent', 'accepted', 'in_progress', 'blocked') AND t.due_date < current_date)::int AS overdue,
       count(t.id) FILTER (WHERE t.escalation_state = 'pending')::int AS escalations,
       count(t.id) FILTER (WHERE t.status = 'review')::int AS drafts_ready,
       count(t.id) FILTER (WHERE t.status = 'running')::int AS running
     FROM action_plans p LEFT JOIN action_tasks t ON t.plan_id = p.id
    WHERE p.requester_id = $1`,
    [userId],
  );
  const { rows: q } = await query(
    `SELECT count(*)::int AS queued FROM outbound_emails e JOIN action_tasks t ON t.id = e.task_id
       JOIN action_plans p ON p.id = t.plan_id WHERE p.requester_id = $1 AND e.status = 'queued'`,
    [userId],
  );
  const s = rows[0];
  const line = (n: number, one: string, many: string, idle: string) => (n ? (n === 1 ? one : many.replace('#', String(n))) : idle);
  return [
    { key: 'dispatcher', name: names.dispatcher, busy: s.planning > 0, status: s.planning ? 'Planning…' : line(s.planned, '1 task planned', '# tasks planned', 'Idle') },
    {
      key: 'herald',
      name: names.herald,
      busy: q[0].queued > 0,
      status: s.awaiting_approval
        ? line(s.awaiting_approval, '1 email awaiting approval', '# emails awaiting approval', '')
        : line(q[0].queued, '1 email queued', '# emails queued', 'Idle'),
    },
    {
      key: 'tracker',
      name: names.tracker,
      busy: s.overdue > 0,
      status: s.escalations
        ? line(s.escalations, '1 escalation needs approval', '# escalations need approval', '')
        : line(s.overdue, '1 task overdue', '# tasks overdue', 'All on track'),
    },
    { key: 'runner', name: names.runner, busy: s.running > 0, status: s.running ? 'Drafting…' : line(s.drafts_ready, '1 draft ready', '# drafts ready', 'Idle') },
  ];
}
