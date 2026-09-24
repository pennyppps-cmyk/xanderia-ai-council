import { writeAudit } from './audit.js';
import { config } from './config.js';
import { notify } from './crew/service.js';
import { query } from './db/pool.js';

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
