import { writeAudit } from '../audit.js';
import { addDays, klParts, nextBusinessMoment } from '../crew/calendar.js';
import { allowedRecipient } from '../crew/email.js';
import { loadCalendar } from '../crew/service.js';
import { signTaskToken } from '../crew/tokens.js';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { getSetting } from '../settings.js';

/**
 * The weekly rhythm: on Monday each person gets one email with their week's tasks in order of
 * urgency; on Friday, a check-in with one-click "done", "on track" and "stuck" per task.
 * Both are off until an admin switches them on (Admin → Settings).
 */
export interface WeekTask {
  id: string;
  title: string;
  due: string | null;
  status: string;
  plan_title: string;
}

export interface WeekGroups {
  overdue: WeekTask[];
  thisWeek: WeekTask[];
  stuck: WeekTask[];
  later: WeekTask[];
}

/** Overdue first, then due this week, then waiting on help, then the next few. */
export function groupWeek(tasks: WeekTask[], today: string): WeekGroups {
  const weekEnd = addDays(today, 6);
  const g: WeekGroups = { overdue: [], thisWeek: [], stuck: [], later: [] };
  for (const t of [...tasks].sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'))) {
    if (t.status === 'blocked') g.stuck.push(t);
    else if (t.due && t.due < today) g.overdue.push(t);
    else if (t.due && t.due <= weekEnd) g.thisWeek.push(t);
    else g.later.push(t);
  }
  g.later = g.later.slice(0, 5);
  return g;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const base = () => config.APP_BASE_URL.replace(/\/+$/, '');
const link = (taskId: string, a: string) => `${base()}/api/t/${signTaskToken(taskId, config.JWT_SECRET)}?a=${a}`;

type Mode = 'plan' | 'checkin';

export function weekEmail(name: string, g: WeekGroups, mode: Mode) {
  const sections: Array<[string, WeekTask[]]> =
    mode === 'plan'
      ? [
          ['Overdue', g.overdue],
          ['Due this week', g.thisWeek],
          ['Waiting for help', g.stuck],
          ['Coming up', g.later],
        ]
      : [
          ['Overdue', g.overdue],
          ['Due by next week', g.thisWeek],
          ['Stuck', g.stuck],
        ];
  const buttons = (t: WeekTask) =>
    mode === 'plan'
      ? [['done', 'Done'], ['help', 'Need help']]
      : [['done', 'Done'], ['start', 'On track'], ['help', 'Stuck']];
  const first = name.split(' ')[0];
  const intro =
    mode === 'plan'
      ? `Good morning ${first}, here is your week in the Xanderia AI Council, most urgent first.`
      : `Hi ${first}, how are these going? One click per task tells the requester, so nobody has to chase you.`;
  const text = [
    intro,
    '',
    ...sections
      .filter(([, list]) => list.length)
      .flatMap(([h, list]) => [
        `${h.toUpperCase()}:`,
        ...list.map((t) => `• ${t.title}${t.due ? ` (due ${t.due})` : ''}. ${buttons(t).map(([a, l]) => `${l}: ${link(t.id, a)}`).join(' · ')}`),
        '',
      ]),
    `All your tasks: ${base()}/tasks`,
    '',
    '— Xanderia AI Council',
  ].join('\n');
  const btn = (href: string, label: string) =>
    `<a href="${esc(href)}" style="display:inline-block;margin:2px 4px 2px 0;padding:4px 10px;border-radius:6px;border:1px solid #c9d5de;color:#0f2a3d;text-decoration:none;font-size:12px">${esc(label)}</a>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f3f6f8;font-family:Segoe UI,Arial,sans-serif;color:#17354a">
<div style="max-width:620px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e3eaef">
<div style="background:#0f2a3d;color:#cdf6ee;padding:14px 20px;font-size:13px;font-weight:600">Xanderia AI Council · ${mode === 'plan' ? 'Your week' : 'Friday check-in'}</div>
<div style="padding:20px"><p style="margin:0 0 14px;line-height:1.5">${esc(intro)}</p>
${sections
  .filter(([, list]) => list.length)
  .map(
    ([h, list]) =>
      `<p style="margin:14px 0 6px;font-size:12px;font-weight:700;letter-spacing:.04em;color:${h === 'Overdue' || h === 'Stuck' ? '#b91c1c' : '#3b556a'}">${esc(h.toUpperCase())}</p>` +
      list
        .map(
          (t) =>
            `<div style="padding:8px 0;border-top:1px solid #eef3f6"><div style="font-weight:600">${esc(t.title)}</div>` +
            `<div style="font-size:12px;color:#7890a3;margin:2px 0 4px">${t.due ? `Due ${esc(t.due)} · ` : ''}${esc(t.plan_title)}</div>` +
            buttons(t).map(([a, l]) => btn(link(t.id, a), l)).join('') +
            `</div>`,
        )
        .join(''),
  )
  .join('')}
<p style="margin:18px 0 0"><a href="${esc(base())}/tasks" style="display:inline-block;padding:9px 16px;border-radius:8px;background:#0f2a3d;color:#fff;text-decoration:none;font-weight:600;font-size:13px">Open my tasks</a></p>
</div></div></body></html>`;
  const count = sections.reduce((n, [, l]) => n + l.length, 0);
  const subject =
    mode === 'plan'
      ? `Your week: ${g.overdue.length ? `${g.overdue.length} overdue, ` : ''}${g.thisWeek.length} due this week / Minggu anda`
      : `Friday check-in: ${count} task(s) / Semakan Jumaat`;
  return { subject, text, html };
}

/** Queue the Monday plan or the Friday check-in for everyone with open tasks. */
export async function weeklyEmails(mode: Mode, now = new Date()) {
  const enabled = await getSetting(mode === 'plan' ? 'weekly_plan_enabled' : 'weekly_checkin_enabled', false);
  if (!enabled) return 0;
  const today = klParts(now).date;
  const { rows } = await query(
    `SELECT s.id AS person, s.name, s.email, t.id, t.title, to_char(t.due_date, 'YYYY-MM-DD') AS due, t.status, p.title AS plan_title
       FROM action_tasks t JOIN action_plans p ON p.id = t.plan_id AND p.status = 'launched'
       JOIN staff_directory s ON s.id = t.directory_id AND s.is_active
      WHERE t.owner_type = 'human' AND t.status IN ('sent', 'accepted', 'in_progress', 'blocked')
        AND (s.away_until IS NULL OR s.away_until < $1::date)
      ORDER BY s.id`,
    [today],
  );
  const people = new Map<string, { name: string; email: string; tasks: WeekTask[] }>();
  for (const r of rows) {
    if (!people.has(r.person)) people.set(r.person, { name: r.name, email: r.email, tasks: [] });
    people.get(r.person)!.tasks.push(r);
  }
  const domains = await getSetting<string[]>('crew_email_domains', ['xanderia.com.my']);
  const sendAfter = nextBusinessMoment(now, await loadCalendar());
  let queued = 0;
  for (const p of people.values()) {
    const g = groupWeek(p.tasks, today);
    // The check-in only asks about work that is due soon or late.
    if (mode === 'checkin' && !g.overdue.length && !g.thisWeek.length && !g.stuck.length) continue;
    if (!allowedRecipient(p.email, domains)) continue;
    const e = weekEmail(p.name, g, mode);
    await query(
      `INSERT INTO outbound_emails (kind, to_email, subject, body_text, body_html, send_after) VALUES ($1, $2, $3, $4, $5, $6)`,
      [mode === 'plan' ? 'week_plan' : 'week_checkin', p.email, e.subject, e.text, e.html, sendAfter],
    );
    queued++;
  }
  if (queued) await writeAudit({ action: mode === 'plan' ? 'weekly_plan_emails' : 'weekly_checkin_emails', detail: { recipients: queued } });
  return queued;
}
