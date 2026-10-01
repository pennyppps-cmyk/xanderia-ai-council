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
import { allowedRecipient, buildTaskEmail, cleanEmailBody, scrubEmailText } from './email.js';
import { getMailProvider, type MailMessage } from './mailer.js';
import { MailboxExpiredError, msConfigured, sendAsUser } from './mailbox.js';
import { childThreadIndex, newMessageId, replySubject, rootThreadIndex, threadKey } from './thread.js';
import { resolveOwner, suggestCollaborators, type Collaborator, type DirectoryEntry } from './resolve.js';
import { signTaskToken } from './tokens.js';
import { DEFAULT_TIMINGS, trackerActions, type TrackerTimings } from './tracker.js';
import { readyToRelease } from '../work/plans.js';

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
    const inserted: Array<{ id: string; title: string; description: string; owner: DirectoryEntry | null; dueDate: string; collaborators: Collaborator[] }> = [];
    // Owners per step, so a task can point to whoever does the steps it depends on.
    const owners = tasks.map((t) => (t.owner_type === 'agent' ? null : resolveOwner(t.owner_role, directory, plan.department_id)));
    const ownerOf = (i: number) => {
      const r = owners[i];
      return r?.directoryId ? directory.find((d) => d.id === r.directoryId) ?? null : null;
    };

    await tx(async (c) => {
      for (const [i, t] of tasks.entries()) {
        const seq = i + 1;
        const isAgent = t.owner_type === 'agent';
        const r = owners[i];
        const self = ownerOf(i);
        const collaborators = isAgent
          ? []
          : suggestCollaborators(
              t.work_with,
              t.depends_on.filter((d) => d >= 1 && d < seq).map((d) => ({ seq: d, person: ownerOf(d - 1) })),
              directory,
              plan.department_id,
              self?.id ?? null,
            );
        const dueDate = addWorkingDays(today, t.due_in_working_days, cal);
        const deps = t.depends_on.filter((d) => d >= 1 && d < seq);
        const { rows: ins } = await c.query(
          `INSERT INTO action_tasks (plan_id, seq, title, description, owner_type, owner_role, directory_id,
                                     resolution, candidates, depends_on, due_date, collaborators)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
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
            JSON.stringify(collaborators),
          ],
        );
        const owner = r?.directoryId ? directory.find((d) => d.id === r.directoryId)! : null;
        if (!isAgent) inserted.push({ id: ins[0].id, title: t.title, description: t.description, owner, dueDate, collaborators });
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
        collaborators: t.collaborators,
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
  collaborators?: Collaborator[];
  language: string;
  userId: string;
}) {
  const people = i.collaborators ?? [];
  // The email template already states the task and due date; the note only gives the background.
  const fallback = `This task is part of the following decision: ${i.why}`;
  try {
    // No base layer: its delimiter wording made the model wrap emails in <document> tags.
    const system = await assemblePrompt({ base: false, task: 'crew_herald' });
    const out = await gateway.call(
      'crew:herald',
      [
        { role: 'system', content: system },
        {
          role: 'user',
          content:
            `Language: ${i.language}\nRecipient's position: ${i.ownerPosition ?? 'colleague'}\nTask: ${i.title}\nWhat done looks like: ${i.description}\nWhy it matters (context): ${i.why}\nDue: ${i.dueDate}` +
            (people.length ? `\nColleagues to work with: ${people.map((p) => `${p.name.split(' ')[0]} (${p.position}; ${p.reason})`).join('; ')}` : ''),
        },
      ],
      { userId: i.userId, sensitivity: 'high', priority: PRIORITY.background, purpose: 'crew:herald' },
    );
    const body = scrubEmailText(cleanEmailBody(out.content));
    return withContacts(body.length >= 20 ? body.slice(0, 1500) : fallback, people, i.language);
  } catch {
    return withContacts(fallback, people, i.language);
  }
}

/** The "who to work with" list is added by code from the directory, never written by the model. */
export function withContacts(body: string, people: Collaborator[], language: string) {
  if (!people.length) return body;
  const head = language === 'Bahasa Malaysia' ? 'Siapa yang perlu anda hubungi:' : 'Who to work with:';
  return `${body}\n\n${head}\n${people.map((p) => `- ${p.name}, ${p.position} (${p.email}): ${p.reason}`).join('\n')}`;
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

type TaskEmailKind = 'task' | 'reminder' | 'escalation';

/** Domain for our Message-IDs: the one in MAIL_FROM. */
const messageIdDomain = () => config.MAIL_FROM.match(/@([a-z0-9.-]+)/i)?.[1] ?? 'xanderia-council';

/** The earlier emails of a thread (plan + recipient) that were or will be sent, oldest first. */
async function threadHistory(key: string) {
  const { rows } = await query(
    `SELECT subject, message_id, references_ids, thread_index FROM outbound_emails
      WHERE thread_key = $1 AND message_id IS NOT NULL AND status NOT IN ('blocked', 'failed') ORDER BY created_at`,
    [key],
  );
  return rows as Array<{ subject: string; message_id: string; references_ids: string[] | null; thread_index: string }>;
}

/**
 * Build a task email exactly as it will be sent: recipient, subject in the plan's thread, body.
 * Used to queue it and, with the requester's unsaved edits (note, owner), to preview it.
 */
export async function composeTaskEmail(
  taskId: string,
  kind: TaskEmailKind,
  opts: { to?: string; emailBody?: string; directoryId?: string | null } = {},
) {
  const { rows } = await query(
    `SELECT t.*, s.name AS owner_name, s.email AS owner_email, s.manager_email,
            p.title AS plan_title, p.requester_id, u.display_name AS requester_name
       FROM action_tasks t
       JOIN action_plans p ON p.id = t.plan_id
       JOIN users u ON u.id = p.requester_id
       LEFT JOIN staff_directory s ON s.id = COALESCE($2::uuid, t.directory_id)
      WHERE t.id = $1`,
    [taskId, opts.directoryId ?? null],
  );
  const t = rows[0];
  if (!t) throw new CrewError('Task not found', 404);
  const to: string | null = kind === 'escalation' ? opts.to ?? t.manager_email : t.owner_email;
  const email = buildTaskEmail({
    kind,
    // Addressed properly: "Dear Aina Rahman," (the escalation letter goes to the manager).
    ownerName: t.owner_name ?? '(choose an owner)',
    assigneeName: kind === 'escalation' ? t.owner_name : undefined,
    title: t.title,
    whatToDo: t.description,
    // The Herald's (or the requester's edited) note; reminders and escalations say only why they are sent.
    body: kind === 'task' ? opts.emailBody ?? t.email_body ?? '' : '',
    reminderNote:
      kind === 'reminder' ? (t.acknowledged_at ? 'Please let us know how it is going.' : 'We have not yet heard whether you can take it on.') : undefined,
    dueDate: t.due_date ? new Date(t.due_date).toISOString().slice(0, 10) : null,
    requesterName: t.requester_name,
    planTitle: t.plan_title,
    links: links(taskId),
  });
  // One conversation per plan and person: the first email sets the subject, later ones reply to it.
  const key = to ? threadKey(t.plan_id, to) : null;
  const history = key ? await threadHistory(key) : [];
  const plan = String(t.plan_title).replace(/\s+/g, ' ').trim();
  const rootSubject = history[0]?.subject.replace(/^(re:\s*)+/i, '') ??
    (kind === 'escalation' ? `Overdue task from ${t.requester_name}: ` : `Tasks from ${t.requester_name}: `) + (plan.length > 90 ? `${plan.slice(0, 88)}…` : plan);
  email.subject = history.length ? replySubject(rootSubject) : rootSubject;
  return { t, to, email, key, history, rootSubject };
}

/** Queue an email for a task. Refuses anything the requester has not approved (HANDOFF §14.6). */
export async function queueTaskEmail(taskId: string, kind: TaskEmailKind, opts: { to?: string } = {}) {
  const { t, to, email, key, history } = await composeTaskEmail(taskId, kind, opts);
  if (!t.approved) throw new CrewError('This task has not been approved by the requester; nothing is sent without approval');
  if (t.owner_type !== 'human' || !t.owner_email) throw new CrewError('Task has no owner from the staff directory');
  if (!to || !key) throw new CrewError('No recipient email');
  const domains = await emailDomains();
  const blocked = !allowedRecipient(to, domains);
  const sendAfter = nextBusinessMoment(new Date(), await loadCalendar());
  const last = history.at(-1);
  const messageId = newMessageId(messageIdDomain());
  const threadIndex = last ? childThreadIndex(last.thread_index, new Date()) : rootThreadIndex(key, new Date());
  await query(
    // Sent from the mailbox of the person who planned the work, in the plan's thread with this person.
    `INSERT INTO outbound_emails (task_id, kind, to_email, subject, body_text, body_html, status, error, send_after, sender_user_id,
                                  thread_key, message_id, in_reply_to, references_ids, thread_index)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      taskId, kind, to, email.subject, email.text, email.html, blocked ? 'blocked' : 'queued',
      blocked ? `Recipient domain not in allowlist (${domains.join(', ')})` : null, sendAfter, t.requester_id,
      key, messageId, last?.message_id ?? null, history.map((h) => h.message_id).slice(-20), threadIndex,
    ],
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
      // An AI-drafted task keeps its person: the draft goes to them once the requester approves it.
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

  // Routine steps wait for the steps they depend on; approved but waiting tasks stay drafts
  // until releaseWaiting() sends them.
  if (plan.source === 'routine') {
    const { rows: now } = await query(`SELECT id, seq, status, approved, depends_on FROM action_tasks WHERE plan_id = $1`, [planId]);
    const ready = new Set(readyToRelease(now));
    for (const list of [toEmail, toRun]) list.splice(0, list.length, ...list.filter((id) => ready.has(id)));
  }

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
  if (toEmail.length || toRun.length || edits.some((e) => e.approved)) {
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
  // An approved AI draft with a person to hand it to becomes their task, draft included.
  if (action === 'approve_draft' && t.status === 'review' && t.directory_id) return handDraftToOwner(t, actor);
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
  if (to === 'done' || to === 'cancelled') await releaseWaiting(t.plan_id);
  await maybeCompletePlan(t.plan_id);
  return { changed: true, status: to };
}

/**
 * The requester deletes their plan and its tasks. Emails still waiting in the outbox are stopped
 * first (they keep no task link after the delete, so the sender would otherwise still send them).
 */
export async function deletePlan(planId: string, userId: string) {
  const { rows: plans } = await query(`SELECT title, status FROM action_plans WHERE id = $1 AND requester_id = $2`, [planId, userId]);
  if (!plans[0]) throw new CrewError('Not found', 404);
  const counts = await tx(async (c) => {
    const stopped = await c.query(
      `UPDATE outbound_emails SET status = 'blocked', error = 'Plan deleted'
        WHERE status = 'queued' AND task_id IN (SELECT id FROM action_tasks WHERE plan_id = $1)`,
      [planId],
    );
    const { rows } = await c.query(`SELECT count(*)::int AS n FROM action_tasks WHERE plan_id = $1`, [planId]);
    await c.query(`UPDATE meetings SET plan_id = NULL WHERE plan_id = $1`, [planId]);
    await c.query(`DELETE FROM action_plans WHERE id = $1`, [planId]);
    return { tasks: rows[0].n as number, emailsStopped: stopped.rowCount ?? 0 };
  });
  await writeAudit({ actorUserId: userId, action: 'action_plan_deleted', targetType: 'action_plan', targetId: planId, detail: { title: plans[0].title, status: plans[0].status, ...counts } });
  return counts;
}

/** Longest AI draft copied into a task email; the full draft stays on the task in the app. */
const DRAFT_IN_EMAIL = 8000;

export function draftHandoverBody(intro: string, draft: string, requesterName: string) {
  const text = draft.trim();
  const cut = text.length > DRAFT_IN_EMAIL ? `${text.slice(0, DRAFT_IN_EMAIL).replace(/\s+\S*$/, '')}\n\n[… the full draft is in the task in the Xanderia AI Council app]` : text;
  const head = intro.trim() ? `${intro.trim()}\n\n` : '';
  return `${head}To help you get started, a first draft has been prepared and reviewed by ${requesterName}. Please check it, complete anything marked [TO FILL] and mark the task as done when it is finished.\n\n---------- DRAFT ----------\n${cut}\n---------- END OF DRAFT ----------`;
}

async function handDraftToOwner(t: { id: string; plan_id: string; requester_id: string; email_body: string | null; description: string; agent_output: string | null }, actor: string) {
  const { rows } = await query(`SELECT display_name FROM users WHERE id = $1`, [t.requester_id]);
  await query(
    `UPDATE action_tasks SET owner_type = 'human', approved = true, resolution = 'resolved', email_body = $2, updated_at = now() WHERE id = $1`,
    [t.id, draftHandoverBody(t.email_body ?? '', t.agent_output ?? '', rows[0]?.display_name ?? 'the requester')],
  );
  const r = await queueTaskEmail(t.id, 'task');
  const to = r.blocked ? 'blocked' : 'sent';
  await query(`UPDATE action_tasks SET status = $2, sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END WHERE id = $1`, [t.id, to]);
  await taskEvent(t.id, 'draft_handed_over', actor);
  await writeAudit({ action: 'task_status_changed', targetType: 'action_task', targetId: t.id, detail: { from: 'review', to, actor, draft_handed_over: true } });
  return { changed: true, status: to };
}

/** A routine step finished: send the approved steps that were waiting for it. */
export async function releaseWaiting(planId: string) {
  const { rows: plan } = await query(`SELECT source, status FROM action_plans WHERE id = $1`, [planId]);
  if (plan[0]?.source !== 'routine' || plan[0].status !== 'launched') return [];
  const { rows: tasks } = await query(`SELECT id, seq, status, approved, depends_on, owner_type FROM action_tasks WHERE plan_id = $1`, [planId]);
  const released = readyToRelease(tasks);
  for (const id of released) {
    const t = tasks.find((x) => x.id === id)!;
    if (t.owner_type === 'agent') {
      await query(`UPDATE action_tasks SET status = 'running' WHERE id = $1`, [id]);
      await taskEvent(id, 'runner_queued', 'runner');
      const { enqueueRunner } = await import('../queue/crewQueue.js');
      await enqueueRunner(id);
    } else {
      const r = await queueTaskEmail(id, 'task');
      await query(`UPDATE action_tasks SET status = $2, sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END WHERE id = $1`, [id, r.blocked ? 'blocked' : 'sent']);
      await taskEvent(id, 'released', 'tracker', { reason: 'the steps it depends on are done' });
    }
  }
  return released;
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

export async function sendQueuedEmails(now = new Date(), fetchImpl: typeof fetch = fetch) {
  const cal = await loadCalendar();
  // No task emails outside business hours; account emails (invites, resets) go straight away.
  const inHours = isBusinessHours(now, cal);
  const provider = getMailProvider();
  const domains = await emailDomains();
  const viaMailboxes = msConfigured();
  const { rows } = await query(
    `SELECT e.* FROM outbound_emails e
      WHERE e.status = 'queued' AND e.send_after <= $1 AND ($2 OR e.kind = 'account')
        -- With Microsoft set up, an email from a user waits until their own mailbox is connected.
        AND (e.sender_user_id IS NULL OR NOT $3
             OR EXISTS (SELECT 1 FROM user_mailboxes m WHERE m.user_id = e.sender_user_id AND m.status = 'ok'))
      ORDER BY e.created_at LIMIT 25`,
    [now, inHours, viaMailboxes],
  );
  const toldToReconnect = new Set<string>();
  for (const e of rows) {
    if (!allowedRecipient(e.to_email, domains)) {
      await query(`UPDATE outbound_emails SET status = 'blocked', error = 'Recipient domain not in allowlist' WHERE id = $1`, [e.id]);
      continue;
    }
    const msg: MailMessage = {
      to: e.to_email,
      subject: e.subject,
      text: e.body_text,
      html: e.body_html,
      ...(e.message_id
        ? {
            threading: {
              messageId: e.message_id,
              inReplyTo: e.in_reply_to ?? undefined,
              references: e.references_ids ?? [],
              threadTopic: e.subject.replace(/^(re:\s*)+/i, ''),
              threadIndex: e.thread_index,
            },
          }
        : {}),
    };
    const fromUser = viaMailboxes && e.sender_user_id;
    const providerId = fromUser ? 'microsoft' : provider.id;
    try {
      const result = fromUser ? await sendAsUser(e.sender_user_id, msg, fetchImpl) : await provider.send(msg);
      await query(`UPDATE outbound_emails SET status = $2, provider = $3, sent_at = now(), error = NULL WHERE id = $1`, [e.id, result, providerId]);
      await writeAudit({ action: 'email_sent', targetType: 'outbound_email', targetId: e.id, detail: { kind: e.kind, to: e.to_email, provider: providerId, result, sender: e.sender_user_id ?? null } });
    } catch (err) {
      if (err instanceof MailboxExpiredError) {
        // Stays queued and goes out once they reconnect. Tell them once.
        await query(`UPDATE outbound_emails SET error = 'Waiting for the sender to reconnect their Microsoft email' WHERE id = $1`, [e.id]);
        if (!toldToReconnect.has(e.sender_user_id)) {
          toldToReconnect.add(e.sender_user_id);
          await notify(e.sender_user_id, { kind: 'mailbox_expired', title: 'Reconnect your Microsoft email: your emails are waiting to be sent', link: '/' });
        }
        continue;
      }
      await query(`UPDATE outbound_emails SET status = 'failed', provider = $3, error = $2 WHERE id = $1`, [e.id, (err as Error).message, providerId]);
    }
  }
  return rows.length;
}

// ── 6. Runner (agent tasks) ──────────────────────────────────────────────────

export async function runAgentTask(taskId: string) {
  const { rows } = await query(
    `SELECT t.*, p.requester_id, p.id AS plan_id, m.verdict, p.context, p.title AS plan_title
       FROM action_tasks t JOIN action_plans p ON p.id = t.plan_id LEFT JOIN messages m ON m.id = p.message_id
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
          content: `Deliverable: ${t.title}\nWhat done looks like: ${t.description}\n\n` +
            (t.verdict ? `Context, the council's decision: ${(t.verdict as Verdict).verdict}` : `Context: ${t.plan_title}. ${t.context ?? ''}`.trim()),
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
