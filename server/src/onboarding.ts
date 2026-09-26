import { writeAudit } from './audit.js';
import { config } from './config.js';
import { notify } from './crew/service.js';
import { query } from './db/pool.js';
import { queueNoticeEmail } from './jobs.js';

/**
 * Onboarding checklist. Every item is checked against what the person (or their department) has
 * actually done, so it cannot be ticked without doing it. Department leads get the setup tasks that
 * make the council useful for their department; everyone else a short "try it" list.
 */
export interface OnboardingItem {
  key: string;
  title: string;
  hint: string;
  link: string;
  done: boolean;
}

export async function onboardingFor(user: { id: string; role: string; department_id: string }) {
  const lead = user.role === 'dept_lead';
  const { rows } = await query(
    `SELECT
       (SELECT count(*) FROM house_rules WHERE is_active AND department_id = $2)::int AS rules,
       (SELECT count(*) FROM documents WHERE department_id = $2)::int AS docs,
       (SELECT count(*) FROM approved_answers WHERE status = 'suggested' AND department_id = $2)::int AS pending,
       (SELECT count(*) FROM messages m JOIN conversations c ON c.id = m.conversation_id
         WHERE c.user_id = $1 AND m.role = 'assistant' AND m.status = 'done' AND m.mode IN ('quick', 'council'))::int AS answers,
       (SELECT count(*) FROM messages m JOIN conversations c ON c.id = m.conversation_id
         WHERE c.user_id = $1 AND m.role = 'assistant' AND m.status = 'done' AND m.mode = 'council')::int AS councils,
       (SELECT count(*) FROM messages m JOIN conversations c ON c.id = m.conversation_id
         WHERE c.user_id = $1 AND m.role = 'assistant' AND m.options ? 'template')::int AS templates,
       (SELECT count(*) FROM decisions WHERE recorded_by = $1)::int AS decisions,
       u.onboarding_dismissed_at
     FROM users u WHERE u.id = $1`,
    [user.id, user.department_id],
  );
  const s = rows[0];
  const items: OnboardingItem[] = lead
    ? [
        { key: 'rules', title: 'Add at least 3 house rules for your department', hint: 'Definitions, limits and policies the council must never get wrong.', link: '/admin/memory', done: s.rules >= 3 },
        { key: 'knowledge', title: 'Upload at least one SOP or policy to Knowledge', hint: "The council cites your department's documents in its answers.", link: '/admin/knowledge', done: s.docs >= 1 },
        { key: 'review', title: "Clear your department's suggested-answers queue", hint: 'Approve good answers so the council reuses them.', link: '/admin/memory', done: s.pending === 0 },
        { key: 'council', title: 'Ask your first council question', hint: 'Bring a real plan or decision from your department.', link: '/', done: s.councils >= 1 },
        { key: 'decision', title: 'Record a decision in the register', hint: 'Under a council verdict, press "Record as decision". Outcomes teach the council what works.', link: '/decisions', done: s.decisions >= 1 },
      ]
    : [
        { key: 'ask', title: 'Ask your first question', hint: 'Anything about your work, in English or Bahasa Malaysia.', link: '/', done: s.answers >= 1 },
        { key: 'template', title: 'Try a template', hint: 'Press "Templates" in the question box.', link: '/', done: s.templates >= 1 },
        { key: 'council', title: 'Bring a plan or decision to the council', hint: 'Six advisors weigh in and the Chairman gives one verdict.', link: '/', done: s.councils >= 1 },
      ];
  const done = items.filter((i) => i.done).length;
  return { lead, items, done, total: items.length, complete: done === items.length, dismissed: Boolean(s.onboarding_dismissed_at) };
}

const appUrl = (path: string) => `${config.APP_BASE_URL.replace(/\/+$/, '')}${path}`;

/**
 * Daily: welcome new leads with a notification, then remind leads whose setup is unfinished,
 * 3 days after joining and every 4 days after, at most 3 times.
 */
export async function onboardingNudges() {
  const { rows: leads } = await query(
    `SELECT id, email, display_name, role, department_id, created_at, onboarding_welcomed_at, onboarding_reminders, onboarding_reminded_at
       FROM users WHERE is_active AND role = 'dept_lead' AND department_id IS NOT NULL`,
  );
  let welcomed = 0;
  let reminded = 0;
  for (const u of leads) {
    const o = await onboardingFor(u);
    if (o.complete) continue;
    if (!u.onboarding_welcomed_at) {
      await notify(u.id, {
        kind: 'onboarding',
        title: `Welcome, department lead: ${o.total} setup steps for your department`,
        body: 'They make the council accurate for your team. Your progress shows on the home screen.',
        link: '/',
      });
      await query(`UPDATE users SET onboarding_welcomed_at = now() WHERE id = $1`, [u.id]);
      welcomed++;
      continue;
    }
    const since = u.onboarding_reminded_at ?? u.created_at;
    const due = u.onboarding_reminders < 3 && Date.now() - new Date(since).getTime() >= (u.onboarding_reminders ? 4 : 3) * 86_400_000;
    if (!due) continue;
    const left = o.items.filter((i) => !i.done);
    await notify(u.id, {
      kind: 'onboarding',
      title: `${o.done} of ${o.total} setup steps done. Next: ${left[0].title.toLowerCase()}`,
      body: left.map((i) => i.title).join(' · '),
      link: left[0].link,
    });
    await queueNoticeEmail(
      'digest',
      u.email,
      `Finish setting up the Xanderia AI Council for your department (${o.done}/${o.total}) / Lengkapkan persediaan`,
      [
        `Hi ${u.display_name},`,
        `As a department lead, a few short steps make the council accurate for your team. You have done ${o.done} of ${o.total}. Still to do:`,
        left.map((i) => `• ${i.title}: ${i.hint}`).join('\n'),
        `Anda telah melengkapkan ${o.done} daripada ${o.total} langkah persediaan. Sila lengkapkan yang selebihnya.`,
      ],
      { label: 'Open the council / Buka majlis', href: appUrl(left[0].link) },
    );
    await query(`UPDATE users SET onboarding_reminders = onboarding_reminders + 1, onboarding_reminded_at = now(), onboarding_dismissed_at = NULL WHERE id = $1`, [u.id]);
    reminded++;
  }
  if (welcomed || reminded) await writeAudit({ action: 'onboarding_nudges', detail: { welcomed, reminded } });
  return { welcomed, reminded };
}
