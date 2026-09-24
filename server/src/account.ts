import { createHash, randomBytes } from 'node:crypto';
import { writeAudit } from './audit.js';
import { config } from './config.js';
import { query } from './db/pool.js';
import { allowedRecipient } from './crew/email.js';
import { getSetting } from './settings.js';

/**
 * Account invites and password resets: a single-use, expiring link emailed to the user.
 * Only a hash of the token is stored. Emails go through the outbox (sent immediately,
 * not held for business hours).
 */
export type TokenPurpose = 'invite' | 'reset';
const TTL_HOURS: Record<TokenPurpose, number> = { invite: 7 * 24, reset: 1 };

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function accountLink(token: string) {
  return `${config.APP_BASE_URL.replace(/\/+$/, '')}/set-password?token=${encodeURIComponent(token)}`;
}

export async function createPasswordToken(userId: string, purpose: TokenPurpose, createdBy?: string) {
  // A new link replaces any earlier unused ones.
  await query(`UPDATE password_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [userId]);
  const token = randomBytes(32).toString('base64url');
  await query(
    `INSERT INTO password_tokens (user_id, token_hash, purpose, expires_at, created_by)
     VALUES ($1, $2, $3, now() + make_interval(hours => $4), $5)`,
    [userId, hashToken(token), purpose, TTL_HOURS[purpose], createdBy ?? null],
  );
  return token;
}

/** Valid, unused, unexpired token → its user. */
export async function lookupPasswordToken(token: string) {
  const { rows } = await query(
    `SELECT t.id, t.purpose, u.id AS user_id, u.email, u.display_name, u.locale
       FROM password_tokens t JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > now() AND u.is_active`,
    [hashToken(token)],
  );
  return rows[0] ?? null;
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Bilingual (English + Bahasa Malaysia) email with the set-password link. */
export function buildAccountEmail(i: { name: string; email: string; purpose: TokenPurpose; link: string; invitedBy?: string }) {
  const invite = i.purpose === 'invite';
  const subject = invite
    ? 'Your Xanderia AI Council account / Akaun Xanderia AI Council anda'
    : 'Reset your Xanderia AI Council password / Tetapkan semula kata laluan';
  const en = invite
    ? [
        `An account has been created for you on Xanderia AI Council${i.invitedBy ? ` by ${i.invitedBy}` : ''}, our internal AI advisory assistant.`,
        `Your login is ${i.email}. Use the link below to set your password. The link works once and expires in 7 days.`,
      ]
    : ['Someone (hopefully you) asked to reset your Xanderia AI Council password.', 'Use the link below to choose a new one. It works once and expires in 1 hour. If you did not ask for this, ignore this email.'];
  const ms = invite
    ? [
        `Akaun telah dicipta untuk anda di Xanderia AI Council${i.invitedBy ? ` oleh ${i.invitedBy}` : ''}, pembantu penasihat AI dalaman kita.`,
        `Log masuk anda ialah ${i.email}. Gunakan pautan di bawah untuk menetapkan kata laluan. Pautan ini sah sekali sahaja dan tamat dalam 7 hari.`,
      ]
    : ['Seseorang (mudah-mudahan anda) meminta untuk menetapkan semula kata laluan Xanderia AI Council anda.', 'Gunakan pautan di bawah untuk memilih kata laluan baharu. Ia sah sekali sahaja dan tamat dalam 1 jam. Jika bukan anda yang meminta, abaikan e-mel ini.'];
  const button = invite ? 'Set your password / Tetapkan kata laluan' : 'Choose a new password / Pilih kata laluan baharu';

  const text = [`Hi ${i.name},`, '', ...en, '', `${button}: ${i.link}`, '', '---', '', `Hai ${i.name},`, '', ...ms, '', '— Xanderia AI Council'].join('\n');
  const para = (t: string) => `<p style="margin:0 0 10px;line-height:1.5">${esc(t)}</p>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f3f6f8;font-family:Segoe UI,Arial,sans-serif;color:#17354a">
<div style="max-width:560px;margin:24px auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e3eaef">
<div style="background:#0f2a3d;color:#cdf6ee;padding:14px 20px;font-size:13px;font-weight:600">Xanderia AI Council</div>
<div style="padding:20px">
${para(`Hi ${i.name},`)}${en.map(para).join('')}
<p style="margin:18px 0"><a href="${esc(i.link)}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#0f2a3d;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px">${esc(button)}</a></p>
<hr style="border:0;border-top:1px solid #e3eaef;margin:18px 0">
${para(`Hai ${i.name},`)}${ms.map(para).join('')}
<p style="margin:16px 0 0;font-size:11px;color:#7890a3">If the button does not work, copy this link / Jika butang tidak berfungsi, salin pautan ini:<br>${esc(i.link)}</p>
</div></div></body></html>`;
  return { subject, text, html };
}

/**
 * Create a link and queue the email. Returns the link too, so an admin can hand it over
 * directly when email is not connected yet (MAIL_PROVIDER=outbox) or the address is blocked.
 */
export async function sendAccountLink(userId: string, purpose: TokenPurpose, actor?: { id: string; name: string }) {
  const { rows } = await query(`SELECT id, email, display_name FROM users WHERE id = $1 AND is_active`, [userId]);
  const u = rows[0];
  if (!u) throw new Error('User not found or inactive');
  const token = await createPasswordToken(u.id, purpose, actor?.id);
  const link = accountLink(token);
  const mail = buildAccountEmail({ name: u.display_name, email: u.email, purpose, link, invitedBy: actor?.name });
  const domains = await getSetting<string[]>('crew_email_domains', ['xanderia.com.my']);
  const blocked = !allowedRecipient(u.email, domains);
  await query(
    `INSERT INTO outbound_emails (kind, to_email, subject, body_text, body_html, status, error)
     VALUES ('account', $1, $2, $3, $4, $5, $6)`,
    [u.email, mail.subject, mail.text, mail.html, blocked ? 'blocked' : 'queued', blocked ? `Recipient domain not in allowlist (${domains.join(', ')})` : null],
  );
  await writeAudit({ actorUserId: actor?.id, action: purpose === 'invite' ? 'account_invite_sent' : 'password_reset_requested', targetType: 'user', targetId: u.id, detail: { blocked } });
  return { link, blocked, emailed: !blocked && config.MAIL_PROVIDER !== 'outbox' };
}
