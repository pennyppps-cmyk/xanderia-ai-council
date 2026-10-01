import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { redis } from '../redis.js';
import type { MailMessage } from './mailer.js';

/**
 * Each user's own Microsoft 365 mailbox. A user connects once (OAuth 2.0 authorization code + PKCE,
 * delegated Mail.Send); emails they cause (task, reminder, escalation, welcome) are then sent from
 * their mailbox through Microsoft Graph, so they appear in their Sent Items and replies go to them.
 * The app can send as the user but cannot read their mail. Tokens are encrypted at rest.
 */

const SCOPES = 'offline_access User.Read Mail.Send';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const STATE_TTL_S = 600;

export class MailboxExpiredError extends Error {}

export function msConfigured() {
  return Boolean(config.MS_CLIENT_ID && config.MS_CLIENT_SECRET && config.MS_TENANT_ID);
}

export function msRedirectUri() {
  return config.MS_REDIRECT_URI ?? `${config.APP_BASE_URL.replace(/\/+$/, '')}/api/auth/microsoft/callback`;
}

const authority = () => `https://login.microsoftonline.com/${encodeURIComponent(config.MS_TENANT_ID ?? 'organizations')}/oauth2/v2.0`;

// ── Token encryption (AES-256-GCM) ──────────────────────────────────────────

function key() {
  return config.MS_TOKEN_KEY
    ? createHash('sha256').update(config.MS_TOKEN_KEY).digest()
    : Buffer.from(hkdfSync('sha256', config.JWT_SECRET, 'xanderia-council', 'mailbox-tokens', 32));
}

export function seal(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64url')).join('.');
}

export function unseal(sealed: string) {
  const [iv, tag, enc] = sealed.split('.').map((p) => Buffer.from(p, 'base64url'));
  const d = createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

// ── Connecting ───────────────────────────────────────────────────────────────

/** The Microsoft sign-in URL. State and the PKCE verifier live in Redis for 10 minutes, single use. */
export async function connectUrl(userId: string, loginHint?: string) {
  if (!msConfigured()) throw new Error('Microsoft email is not set up yet');
  const state = randomBytes(24).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  await redis.set(`ms:state:${state}`, JSON.stringify({ userId, verifier }), 'EX', STATE_TTL_S);
  const p = new URLSearchParams({
    client_id: config.MS_CLIENT_ID!,
    response_type: 'code',
    redirect_uri: msRedirectUri(),
    response_mode: 'query',
    scope: SCOPES,
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    prompt: 'select_account',
    ...(loginHint ? { login_hint: loginHint } : {}),
  });
  return `${authority()}/authorize?${p}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

async function tokenRequest(params: Record<string, string>, fetchImpl: typeof fetch): Promise<TokenResponse> {
  const res = await fetchImpl(`${authority()}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.MS_CLIENT_ID!, client_secret: config.MS_CLIENT_SECRET!, scope: SCOPES, ...params }),
    signal: AbortSignal.timeout(15_000),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error_description?.split('\r\n')[0] ?? data.error ?? `Microsoft token endpoint returned ${res.status}`);
    // invalid_grant: the refresh token was revoked or expired, so only reconnecting helps.
    if (data.error === 'invalid_grant' || data.error === 'interaction_required') throw new MailboxExpiredError(err.message);
    throw err;
  }
  return data;
}

/** Finish the sign-in: swap the code for tokens, read who signed in, and store the mailbox. */
export async function completeConnect(code: string, state: string, fetchImpl: typeof fetch = fetch) {
  const raw = await redis.getdel(`ms:state:${state}`);
  if (!raw) throw new Error('This sign-in link has expired. Please try connecting again.');
  const { userId, verifier } = JSON.parse(raw) as { userId: string; verifier: string };
  const t = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: msRedirectUri(), code_verifier: verifier }, fetchImpl);
  if (!t.refresh_token) throw new Error('Microsoft did not grant offline access (offline_access permission missing)');
  const res = await fetchImpl(`${GRAPH}/me?$select=mail,userPrincipalName,displayName`, {
    headers: { authorization: `Bearer ${t.access_token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Could not read your Microsoft profile (${res.status})`);
  const me: any = await res.json();
  const address = String(me.mail || me.userPrincipalName || '').toLowerCase();
  await query(
    `INSERT INTO user_mailboxes (user_id, address, display_name, refresh_token_enc, access_token_enc, access_expires_at, status, last_error, connected_at)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(secs => $6), 'ok', NULL, now())
     ON CONFLICT (user_id) DO UPDATE SET address = EXCLUDED.address, display_name = EXCLUDED.display_name,
       refresh_token_enc = EXCLUDED.refresh_token_enc, access_token_enc = EXCLUDED.access_token_enc,
       access_expires_at = EXCLUDED.access_expires_at, status = 'ok', last_error = NULL, connected_at = now()`,
    [userId, address, me.displayName ?? null, seal(t.refresh_token), seal(t.access_token), Math.max(60, t.expires_in - 120)],
  );
  return { userId, address };
}

export async function disconnectMailbox(userId: string) {
  await query(`DELETE FROM user_mailboxes WHERE user_id = $1`, [userId]);
}

// ── Sending ──────────────────────────────────────────────────────────────────

async function accessToken(userId: string, fetchImpl: typeof fetch) {
  const { rows } = await query(`SELECT * FROM user_mailboxes WHERE user_id = $1`, [userId]);
  const m = rows[0];
  if (!m || m.status !== 'ok') throw new MailboxExpiredError('Mailbox not connected');
  if (m.access_token_enc && m.access_expires_at && new Date(m.access_expires_at) > new Date()) return unseal(m.access_token_enc);
  try {
    const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: unseal(m.refresh_token_enc) }, fetchImpl);
    await query(
      `UPDATE user_mailboxes SET access_token_enc = $2, access_expires_at = now() + make_interval(secs => $3),
              refresh_token_enc = COALESCE($4, refresh_token_enc) WHERE user_id = $1`,
      [userId, seal(t.access_token), Math.max(60, t.expires_in - 120), t.refresh_token ? seal(t.refresh_token) : null],
    );
    return t.access_token;
  } catch (err) {
    if (err instanceof MailboxExpiredError) {
      await query(`UPDATE user_mailboxes SET status = 'expired', last_error = $2, access_token_enc = NULL WHERE user_id = $1`, [userId, err.message]);
    }
    throw err;
  }
}

/** Send as the user through Graph. MailboxExpiredError means: hold the email until they reconnect. */
export async function sendAsUser(userId: string, msg: MailMessage, fetchImpl: typeof fetch = fetch) {
  const token = await accessToken(userId, fetchImpl);
  const res = await fetchImpl(`${GRAPH}/me/sendMail`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      message: { subject: msg.subject, body: { contentType: 'HTML', content: msg.html }, toRecipients: [{ emailAddress: { address: msg.to } }] },
      saveToSentItems: true,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 401) {
    // Token rejected (e.g. consent revoked): drop the cached one; the next try refreshes or marks it expired.
    await query(`UPDATE user_mailboxes SET access_token_enc = NULL WHERE user_id = $1`, [userId]);
    throw new Error('Microsoft rejected the access token (401)');
  }
  if (!res.ok) {
    const data: any = await res.json().catch(() => ({}));
    throw new Error(`Microsoft Graph sendMail ${res.status}: ${data.error?.message ?? 'failed'}`);
  }
  await query(`UPDATE user_mailboxes SET last_used_at = now() WHERE user_id = $1`, [userId]);
  return 'sent' as const;
}

/** For the UI: is Microsoft set up, is this user connected, and how many of their emails are waiting. */
export async function mailboxStatus(userId: string) {
  if (!msConfigured()) return { configured: false, connected: false, address: null, status: null, held: 0 };
  const { rows } = await query(
    `SELECT m.address, m.status,
            (SELECT count(*)::int FROM outbound_emails e WHERE e.sender_user_id = $1 AND e.status = 'queued') AS queued
       FROM (SELECT 1) x LEFT JOIN user_mailboxes m ON m.user_id = $1`,
    [userId],
  );
  const r = rows[0];
  const connected = r.status === 'ok';
  return { configured: true, connected, address: r.address ?? null, status: r.status ?? null, held: connected ? 0 : r.queued };
}
