import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { mailboxStatus, msConfigured } from './crew/mailbox.js';
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

// ── Welcome email with a temporary password ─────────────────────────────────

export const TEMP_PASSWORD_DAYS = 7;
// No look-alike characters (0/O, 1/l/I), so it can be read out or typed from a phone.
const TEMP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/** Three groups of four, e.g. "Hk7m-Pq4r-Tz9w". */
export function generateTempPassword() {
  const bytes = randomBytes(12);
  const chars = [...bytes].map((b) => TEMP_ALPHABET[b % TEMP_ALPHABET.length]);
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8)].map((g) => g.join('')).join('-');
}

export const loginUrl = () => `${config.APP_BASE_URL.replace(/\/+$/, '')}/`;

/** Bilingual welcome: the system link, their login, and the temporary password to change at first sign-in. */
export function buildWelcomeEmail(i: { name: string; email: string; password: string; link: string; invitedBy?: string; microsoft?: boolean }) {
  const subject = 'Welcome to Xanderia AI Council / Selamat datang ke Xanderia AI Council';
  const en = [
    `An account has been created for you on Xanderia AI Council${i.invitedBy ? ` by ${i.invitedBy}` : ''}, our internal AI advisory assistant.`,
    `Sign in at ${i.link} with:`,
  ];
  const enAfter = [
    `This temporary password works for ${TEMP_PASSWORD_DAYS} days. You will choose your own password when you first sign in.`,
    ...(i.microsoft ? ['After that you will be asked to connect your Microsoft work email, so tasks you plan are emailed to staff from your own mailbox.'] : []),
  ];
  const ms = [
    `Akaun telah dicipta untuk anda di Xanderia AI Council${i.invitedBy ? ` oleh ${i.invitedBy}` : ''}, pembantu penasihat AI dalaman kita.`,
    `Log masuk di ${i.link} dengan:`,
  ];
  const msAfter = [
    `Kata laluan sementara ini sah selama ${TEMP_PASSWORD_DAYS} hari. Anda akan memilih kata laluan sendiri semasa log masuk kali pertama.`,
    ...(i.microsoft ? ['Selepas itu anda akan diminta menyambungkan e-mel kerja Microsoft anda, supaya tugasan yang anda rancang dihantar kepada staf dari peti mel anda sendiri.'] : []),
  ];
  const creds = (emailLabel: string, pwLabel: string) => [`  ${emailLabel}: ${i.email}`, `  ${pwLabel}: ${i.password}`];
  const text = [
    `Hi ${i.name},`, '', ...en, ...creds('Email', 'Temporary password'), '', ...enAfter, '', '---', '',
    `Hai ${i.name},`, '', ...ms, ...creds('E-mel', 'Kata laluan sementara'), '', ...msAfter, '', '— Xanderia AI Council',
  ].join('\n');
  const para = (t: string) => `<p style="margin:0 0 10px;line-height:1.5">${esc(t)}</p>`;
  const box = (emailLabel: string, pwLabel: string) =>
    `<table style="margin:4px 0 14px;font-size:14px;border-collapse:collapse;background:#effcf9;border-left:4px solid #0d9488">
<tr><td style="padding:8px 14px 2px;color:#7890a3">${esc(emailLabel)}</td><td style="padding:8px 14px 2px;font-weight:600">${esc(i.email)}</td></tr>
<tr><td style="padding:2px 14px 8px;color:#7890a3">${esc(pwLabel)}</td><td style="padding:2px 14px 8px;font-weight:700;font-family:Consolas,monospace;font-size:15px;letter-spacing:.04em">${esc(i.password)}</td></tr></table>`;
  const button = `<p style="margin:6px 0 16px"><a href="${esc(i.link)}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#0f2a3d;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px">Open Xanderia AI Council</a></p>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f3f6f8;font-family:Segoe UI,Arial,sans-serif;color:#17354a">
<div style="max-width:560px;margin:24px auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e3eaef">
<div style="background:#0f2a3d;color:#cdf6ee;padding:14px 20px;font-size:13px;font-weight:600">Xanderia AI Council</div>
<div style="padding:20px">
${para(`Hi ${i.name},`)}${para(en[0])}${para(en[1])}${box('Email', 'Temporary password')}${enAfter.map(para).join('')}${button}
<hr style="border:0;border-top:1px solid #e3eaef;margin:18px 0">
${para(`Hai ${i.name},`)}${para(ms[0])}${para(ms[1])}${box('E-mel', 'Kata laluan sementara')}${msAfter.map(para).join('')}
<p style="margin:16px 0 0;font-size:11px;color:#7890a3">If the button does not work, copy this link / Jika butang tidak berfungsi, salin pautan ini:<br>${esc(i.link)}</p>
</div></div></body></html>`;
  return { subject, text, html };
}

/**
 * Give the user a new temporary password (must be changed at first sign-in) and queue the welcome
 * email from the admin's own mailbox. The password is returned once, so the admin can hand it over
 * if the email cannot be delivered.
 */
export async function sendWelcome(userId: string, actor: { id: string; name: string }) {
  const { rows } = await query(`SELECT id, email, display_name FROM users WHERE id = $1 AND is_active`, [userId]);
  const u = rows[0];
  if (!u) throw new Error('User not found or inactive');
  const password = generateTempPassword();
  await query(
    `UPDATE users SET password_hash = $2, must_change_password = true,
            temp_password_expires_at = now() + make_interval(days => $3) WHERE id = $1`,
    [u.id, await bcrypt.hash(password, 12), TEMP_PASSWORD_DAYS],
  );
  // Any old set-password links stop working.
  await query(`UPDATE password_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [u.id]);
  const microsoft = msConfigured();
  const mail = buildWelcomeEmail({ name: u.display_name, email: u.email, password, link: loginUrl(), invitedBy: actor.name, microsoft });
  const domains = await getSetting<string[]>('crew_email_domains', ['xanderia.com.my']);
  const blocked = !allowedRecipient(u.email, domains);
  await query(
    `INSERT INTO outbound_emails (kind, to_email, subject, body_text, body_html, status, error, sender_user_id)
     VALUES ('account', $1, $2, $3, $4, $5, $6, $7)`,
    [u.email, mail.subject, mail.text, mail.html, blocked ? 'blocked' : 'queued', blocked ? `Recipient domain not in allowlist (${domains.join(', ')})` : null, actor.id],
  );
  await writeAudit({ actorUserId: actor.id, action: 'account_welcome_sent', targetType: 'user', targetId: u.id, detail: { blocked } });
  // Held: Microsoft is set up but the admin's own mailbox is not connected, so it waits for that.
  const held = !blocked && microsoft && !(await mailboxStatus(actor.id)).connected;
  return {
    tempPassword: password,
    link: loginUrl(),
    blocked,
    held,
    emailed: !blocked && !held && (microsoft || config.MAIL_PROVIDER !== 'outbox'),
  };
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
    // Sent by an admin: from their mailbox. "Forgot password" has no sender and goes through MAIL_PROVIDER.
    `INSERT INTO outbound_emails (kind, to_email, subject, body_text, body_html, status, error, sender_user_id)
     VALUES ('account', $1, $2, $3, $4, $5, $6, $7)`,
    [u.email, mail.subject, mail.text, mail.html, blocked ? 'blocked' : 'queued', blocked ? `Recipient domain not in allowlist (${domains.join(', ')})` : null, actor?.id ?? null],
  );
  await writeAudit({ actorUserId: actor?.id, action: purpose === 'invite' ? 'account_invite_sent' : 'password_reset_requested', targetType: 'user', targetId: u.id, detail: { blocked } });
  return { link, blocked, emailed: !blocked && config.MAIL_PROVIDER !== 'outbox' };
}
