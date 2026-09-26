import { writeAudit } from './audit.js';
import { config } from './config.js';
import { notify } from './crew/service.js';
import { pool, query } from './db/pool.js';
import { improvementReport, improvementReportText } from './memory/report.js';

/** Shared plain + HTML email in the Council's style, queued through the outbox. */
export async function queueNoticeEmail(kind: 'digest' | 'checkin', to: string, subject: string, paragraphs: string[], button?: { label: string; href: string }) {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  const text = [...paragraphs, ...(button ? ['', `${button.label}: ${button.href}`] : []), '', '— Xanderia AI Council'].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#f3f6f8;font-family:Segoe UI,Arial,sans-serif;color:#17354a">
<div style="max-width:600px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e3eaef">
<div style="background:#0f2a3d;color:#cdf6ee;padding:14px 20px;font-size:13px;font-weight:600">Xanderia AI Council</div>
<div style="padding:20px">${paragraphs.map((p) => `<p style="margin:0 0 10px;line-height:1.5;white-space:pre-wrap">${esc(p)}</p>`).join('')}
${button ? `<p style="margin:16px 0"><a href="${esc(button.href)}" style="display:inline-block;padding:9px 16px;border-radius:8px;background:#0f2a3d;color:#fff;text-decoration:none;font-weight:600;font-size:13px">${esc(button.label)}</a></p>` : ''}
</div></div></body></html>`;
  await query(
    `INSERT INTO outbound_emails (kind, to_email, subject, body_text, body_html) VALUES ($1, $2, $3, $4, $5)`,
    [kind, to, subject, text, html],
  );
}

const appUrl = (path: string) => `${config.APP_BASE_URL.replace(/\/+$/, '')}${path}`;

/**
 * Outcome check-ins: 30 / 60 days after a decision, ask whoever recorded it whether it worked.
 * Runs daily; each due decision gets one notification + email, then moves to its next check-in.
 */
export async function decisionCheckIns() {
  const { rows } = await query(
    `SELECT d.id, d.title, d.decided_at, d.check_in_days, u.id AS user_id, u.email, u.display_name,
            (current_date - d.decided_at::date) AS age
       FROM decisions d JOIN users u ON u.id = d.recorded_by
      WHERE d.next_check_in <= current_date AND d.status NOT IN ('done', 'dropped') AND u.is_active`,
  );
  for (const d of rows) {
    const link = `/decisions/${d.id}`;
    await notify(d.user_id, {
      kind: 'decision_checkin',
      title: `${d.age} days since you decided "${d.title.slice(0, 80)}". Did it work?`,
      body: 'Record the outcome so the council learns what works.',
      link,
    });
    await queueNoticeEmail(
      'checkin',
      d.email,
      `Did it work? "${d.title.slice(0, 70)}" / Adakah ia berkesan?`,
      [
        `Hi ${d.display_name},`,
        `${d.age} days ago you recorded this decision in the Xanderia AI Council: "${d.title}".`,
        'How did it go? Record the outcome (worked / partly / did not work / too early to tell) so the register shows what works.',
        `${d.age} hari lalu anda merekodkan keputusan ini: "${d.title}". Sila rekodkan hasilnya.`,
      ],
      { label: 'Record the outcome / Rekod hasil', href: appUrl(link) },
    );
    const next = (d.check_in_days as number[]).filter((n) => n > d.age).sort((a, b) => a - b)[0];
    await query(
      `UPDATE decisions SET next_check_in = CASE WHEN $2::int IS NULL THEN NULL ELSE decided_at::date + $2::int END WHERE id = $1`,
      [d.id, next ?? null],
    );
  }
  if (rows.length) await writeAudit({ action: 'decision_checkins_sent', detail: { count: rows.length } });
  return rows.length;
}

/** Documents past their review date (uploaded / last reviewed + review_after_days). */
export const STALE_SQL = `COALESCE(d.reviewed_at, d.created_at) + make_interval(days => d.review_after_days) < now()`;

/**
 * Knowledge freshness: a stale document is flagged to whoever uploaded it and to the leads who
 * manage it (department leads, or admins for company-wide documents), at most once every 30 days.
 */
export async function knowledgeFreshness() {
  const { rows } = await query(
    `SELECT d.id, d.title, d.department_id, d.company_wide, d.uploaded_by,
            (current_date - COALESCE(d.reviewed_at, d.created_at)::date) AS age
       FROM documents d
      WHERE ${STALE_SQL} AND (d.stale_notified_at IS NULL OR d.stale_notified_at < now() - interval '30 days')`,
  );
  for (const d of rows) {
    const { rows: people } = await query(
      `SELECT id FROM users WHERE is_active AND (id = $1
          OR ($2::boolean AND role = 'admin')
          OR (NOT $2::boolean AND role = 'dept_lead' AND department_id = $3))`,
      [d.uploaded_by, d.company_wide, d.department_id],
    );
    for (const p of people) {
      await notify(p.id, {
        kind: 'knowledge_stale',
        title: `"${d.title.slice(0, 80)}" has not been reviewed for ${d.age} days`,
        body: 'The council still quotes it. Check it is current, then mark it reviewed, replace it or delete it.',
        link: '/admin/knowledge',
      });
    }
    await query(`UPDATE documents SET stale_notified_at = now() WHERE id = $1`, [d.id]);
  }
  if (rows.length) await writeAudit({ action: 'knowledge_stale_flagged', detail: { documents: rows.map((d) => d.id) } });
  return rows.length;
}

export interface DigestData {
  department: string;
  questions: number;
  previous: number;
  council: number;
  helpful: number;
  unhelpful: number;
  areas: Array<{ area: string; n: number }>;
  decisions: Array<{ title: string; status: string }>;
  outcomes: Array<{ title: string; rating: string }>;
  overdue: Array<{ title: string; due_date: string; owner: string | null }>;
  stale: Array<{ title: string }>;
}

/**
 * Weekly numbers for one department. Counts only: the content of staff questions is never put
 * in a digest (a head of department should not read what their team asked the council).
 */
export async function digestFor(departmentId: string): Promise<DigestData> {
  const one = async (sql: string) => (await query(sql, [departmentId])).rows;
  const [[dept], [counts], areas, decisions, outcomes, overdue, stale] = await Promise.all([
    one(`SELECT name FROM departments WHERE id = $1`),
    one(`SELECT count(*) FILTER (WHERE m.created_at > now() - interval '7 days')::int AS questions,
                count(*) FILTER (WHERE m.created_at <= now() - interval '7 days')::int AS previous,
                count(*) FILTER (WHERE m.created_at > now() - interval '7 days' AND m.mode = 'council')::int AS council,
                (SELECT count(*) FROM feedback f JOIN messages x ON x.id = f.message_id
                  WHERE x.department_id = $1 AND f.rating = 1 AND f.created_at > now() - interval '7 days')::int AS helpful,
                (SELECT count(*) FROM feedback f JOIN messages x ON x.id = f.message_id
                  WHERE x.department_id = $1 AND f.rating = -1 AND f.created_at > now() - interval '7 days')::int AS unhelpful
           FROM messages m JOIN conversations c ON c.id = m.conversation_id JOIN users u ON u.id = c.user_id
          WHERE m.role = 'assistant' AND u.department_id = $1 AND m.created_at > now() - interval '14 days'`),
    one(`SELECT COALESCE(dep.name, m.router->>'department') AS area, count(*)::int AS n
           FROM messages m JOIN conversations c ON c.id = m.conversation_id JOIN users u ON u.id = c.user_id
           LEFT JOIN departments dep ON dep.slug = m.router->>'department'
          WHERE m.role = 'assistant' AND u.department_id = $1 AND m.router IS NOT NULL AND m.created_at > now() - interval '7 days'
          GROUP BY 1 ORDER BY n DESC LIMIT 5`),
    one(`SELECT title, status FROM decisions WHERE department_id = $1 AND decided_at > now() - interval '7 days' ORDER BY decided_at`),
    one(`SELECT d.title, o.rating FROM decision_outcomes o JOIN decisions d ON d.id = o.decision_id
          WHERE d.department_id = $1 AND o.created_at > now() - interval '7 days' ORDER BY o.created_at`),
    one(`SELECT t.title, t.due_date::text, s.name AS owner FROM action_tasks t JOIN action_plans p ON p.id = t.plan_id
           LEFT JOIN staff_directory s ON s.id = t.directory_id
          WHERE p.department_id = $1 AND p.status = 'launched' AND t.due_date < current_date
            AND t.status NOT IN ('done', 'cancelled', 'draft') ORDER BY t.due_date LIMIT 10`),
    one(`SELECT d.title FROM documents d WHERE d.department_id = $1 AND ${STALE_SQL} ORDER BY d.created_at LIMIT 10`),
  ]);
  return { department: dept?.name ?? '-', ...counts, areas, decisions, outcomes, overdue, stale } as DigestData;
}

const RATING_LABEL: Record<string, string> = { worked: 'worked', partly: 'partly worked', did_not_work: 'did not work', too_early: 'too early to tell' };

export function digestParagraphs(name: string, d: DigestData): string[] {
  const trend = d.previous ? ` (${d.questions >= d.previous ? '+' : ''}${Math.round(((d.questions - d.previous) / d.previous) * 100)}% on the week before)` : '';
  const p = [
    `Hi ${name},`,
    `Your week in the Xanderia AI Council, ${d.department}.`,
    `QUESTIONS: ${d.questions} this week${trend}, ${d.council} of them to the full council. Feedback: ${d.helpful} helpful, ${d.unhelpful} not helpful.` +
      (d.areas.length ? `\nMost asked about: ${d.areas.map((a) => `${a.area} (${a.n})`).join(', ')}.` : ''),
  ];
  if (d.decisions.length) p.push(`DECISIONS RECORDED (${d.decisions.length}):\n${d.decisions.map((x) => `• ${x.title}`).join('\n')}`);
  if (d.outcomes.length) p.push(`OUTCOMES REPORTED:\n${d.outcomes.map((x) => `• ${x.title}: ${RATING_LABEL[x.rating] ?? x.rating}`).join('\n')}`);
  p.push(
    d.overdue.length
      ? `OVERDUE ACTION TASKS (${d.overdue.length}):\n${d.overdue.map((x) => `• ${x.title}, due ${x.due_date}${x.owner ? `, ${x.owner}` : ''}`).join('\n')}`
      : 'OVERDUE ACTION TASKS: none.',
  );
  if (d.stale.length) p.push(`KNOWLEDGE DUE FOR REVIEW (${d.stale.length}):\n${d.stale.map((x) => `• ${x.title}`).join('\n')}`);
  p.push('Ringkasan mingguan jabatan anda: soalan, keputusan, tugasan tertunggak dan dokumen yang perlu disemak.');
  return p;
}

/** Monday morning digest to every department head (dept_lead) who has not opted out. */
export async function weeklyDigests() {
  const { rows: leads } = await query(
    `SELECT id, email, display_name, department_id FROM users
      WHERE is_active AND role = 'dept_lead' AND weekly_digest AND department_id IS NOT NULL`,
  );
  const cache = new Map<string, DigestData>();
  for (const u of leads) {
    if (!cache.has(u.department_id)) cache.set(u.department_id, await digestFor(u.department_id));
    const d = cache.get(u.department_id)!;
    await queueNoticeEmail(
      'digest',
      u.email,
      `Weekly digest, ${d.department}: ${d.questions} questions, ${d.overdue.length} overdue tasks / Ringkasan mingguan`,
      digestParagraphs(u.display_name, d),
      { label: 'Open the decision register / Buka daftar keputusan', href: appUrl('/decisions') },
    );
  }
  if (leads.length) await writeAudit({ action: 'weekly_digest_sent', detail: { recipients: leads.length } });
  return leads.length;
}

/** First of each month: the improvement report to every active admin. */
export async function monthlyImprovementReport() {
  const report = await improvementReport(pool, 30);
  const { rows: admins } = await query(`SELECT email, display_name FROM users WHERE role = 'admin' AND is_active`);
  for (const a of admins) {
    await queueNoticeEmail(
      'digest',
      a.email,
      `Xanderia AI Council: monthly improvement report / Laporan penambahbaikan bulanan`,
      [`Hi ${a.display_name},`, ...improvementReportText(report)],
      { label: 'Open company memory / Buka memori syarikat', href: appUrl('/admin/memory') },
    );
  }
  if (admins.length) await writeAudit({ action: 'improvement_report_sent', detail: { recipients: admins.length } });
  return admins.length;
}
