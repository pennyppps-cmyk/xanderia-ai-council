import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { emailBody, letterFileName, renderLetter } from './letter.js';
import { msDate, type LetterData } from './masterlist.js';

/**
 * Direct sending of notices to customers. Deliberately separate from the Council's staff outbox
 * (which only sends to company domains): it uses its own mailbox (NOTIS_SMTP_*, e.g. the
 * Collections mailbox) and is off until IT configures it. Until then, Collections downloads
 * Outlook drafts and sends them from Outlook.
 */
export interface NotisSender {
  send(msg: { to: string; subject: string; text: string; html: string; attachment: { filename: string; content: Buffer } }): Promise<void>;
}

let sender: NotisSender | null | undefined;

export function notisSender(): NotisSender | null {
  if (sender !== undefined) return sender;
  if (!config.NOTIS_SMTP_HOST) return (sender = null);
  const t = nodemailer.createTransport({
    host: config.NOTIS_SMTP_HOST,
    port: config.NOTIS_SMTP_PORT,
    secure: config.NOTIS_SMTP_SECURE,
    auth: config.NOTIS_SMTP_USER ? { user: config.NOTIS_SMTP_USER, pass: config.NOTIS_SMTP_PASS } : undefined,
  });
  return (sender = {
    async send(m) {
      await t.sendMail({ from: config.NOTIS_MAIL_FROM, to: m.to, subject: m.subject, text: m.text, html: m.html, attachments: [{ ...m.attachment, contentType: 'application/pdf' }] });
    },
  });
}

export function setNotisSender(s: NotisSender | null) {
  sender = s;
}

export async function sendOne(to: string, data: LetterData, noticeDate: string, s: NotisSender) {
  const pdf = await renderLetter(data, noticeDate);
  const e = emailBody(data);
  await s.send({ to, subject: e.subject, text: e.text, html: e.html, attachment: { filename: letterFileName(data), content: pdf } });
}

/** Worker tick: sends queued notices a few at a time with a pause between each (mailbox limits). */
export async function sendQueuedNotis(limit = 20, pauseMs = 2500) {
  const s = notisSender();
  if (!s) return 0;
  const { rows } = await query(
    `SELECT r.id, r.batch_id, r.email, r.data, r.account_number, r.customer_name, to_char(b.notice_date, 'YYYY-MM-DD') AS notice_date, coalesce(r.delivery_by, b.created_by) AS actor
       FROM notis_rows r JOIN notis_batches b ON b.id = r.batch_id
      WHERE r.delivery = 'queued' AND r.data IS NOT NULL ORDER BY b.created_at, r.row_no LIMIT $1`,
    [limit],
  );
  for (const [i, r] of rows.entries()) {
    if (i) await new Promise((res) => setTimeout(res, pauseMs));
    const noticeDate = msDate(r.notice_date);
    try {
      await sendOne(r.email, r.data, noticeDate, s);
      await query(`UPDATE notis_rows SET delivery = 'sent', delivery_to = $2, delivered_at = now(), delivery_error = NULL WHERE id = $1`, [r.id, r.email]);
      await query(`INSERT INTO notis_log (batch_id, actor_id, mode, account_number, customer_name, recipient, status) VALUES ($1, $2, 'live', $3, $4, $5, 'sent')`, [r.batch_id, r.actor, r.account_number, r.customer_name, r.email]);
    } catch (err) {
      const msg = (err as Error).message.slice(0, 300);
      await query(`UPDATE notis_rows SET delivery = 'failed', delivery_error = $2 WHERE id = $1`, [r.id, msg]);
      await query(`INSERT INTO notis_log (batch_id, actor_id, mode, account_number, customer_name, recipient, status) VALUES ($1, $2, 'live', $3, $4, $5, $6)`, [r.batch_id, r.actor, r.account_number, r.customer_name, r.email, `error: ${msg}`]);
    }
  }
  return rows.length;
}
