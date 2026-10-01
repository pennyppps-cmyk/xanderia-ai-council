/**
 * Welcome email with a temporary password, and sending from each user's own Microsoft mailbox
 * (Microsoft is faked: no network calls).
 *   TEST_DATABASE_URL=postgres://council:council@localhost:5433/council_mailbox_test TEST_REDIS_URL=redis://localhost:6380 npm test
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;

/** A fake Microsoft identity platform + Graph. */
function fakeMicrosoft() {
  const calls: { url: string; body: any; auth?: string }[] = [];
  let refreshFails = false;
  const fetchImpl = (async (input: any, init: any = {}) => {
    const u = String(input);
    const body = init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : init.body ? JSON.parse(init.body) : null;
    calls.push({ url: u, body, auth: init.headers?.authorization });
    const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
    if (u.endsWith('/oauth2/v2.0/token')) {
      if (body.grant_type === 'refresh_token' && refreshFails) return json(400, { error: 'invalid_grant', error_description: 'AADSTS50173: The provided grant has expired.' });
      return json(200, { access_token: `access-${calls.length}`, refresh_token: `refresh-${calls.length}`, expires_in: 3600 });
    }
    if (u.includes('/v1.0/me?')) return json(200, { mail: 'Andrew@Xanderia.com.my', displayName: 'Andrew' });
    if (u.endsWith('/v1.0/me/sendMail')) return new Response(null, { status: 202 });
    return json(404, {});
  }) as typeof fetch;
  return { fetchImpl, calls, failRefresh: () => (refreshFails = true) };
}

describe.skipIf(!url || !redisUrl)('welcome email and own Microsoft mailbox (integration)', () => {
  let db: pg.Pool;
  let app: Awaited<ReturnType<typeof import('../../src/app.js')['buildApp']>>;
  let crew: typeof import('../../src/crew/service.js');
  let mailbox: typeof import('../../src/crew/mailbox.js');
  let adminCookie: string;
  let adminId: string;
  let newUserId: string;
  let tempPassword: string;
  const ms = fakeMicrosoft();

  const cookieOf = (res: { headers: Record<string, any> }) => String([res.headers['set-cookie']].flat()[0]).split(';')[0];

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: url!.replace(/\/[^/]+$/, '/postgres') });
    await admin.connect();
    const name = new URL(url!).pathname.slice(1);
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${name}`);
    await admin.end();
    Object.assign(process.env, {
      DATABASE_URL: url,
      REDIS_URL: redisUrl,
      LOG_LEVEL: 'silent',
      ADMIN_EMAIL: 'andrew@xanderia.com.my',
      ADMIN_PASSWORD: 'Admin-password-123',
      APP_BASE_URL: 'https://council.test',
      MS_TENANT_ID: 'tenant-1',
      MS_CLIENT_ID: 'client-1',
      MS_CLIENT_SECRET: 'secret-1',
    });
    await (await import('../../src/db/migrate.js')).migrate(url!, () => {});
    await (await import('../../src/db/seed.js')).seed(() => {});
    db = new pg.Pool({ connectionString: url });
    await db.query(`DELETE FROM settings WHERE key = 'crew_email_domains'`).catch(() => {});
    crew = await import('../../src/crew/service.js');
    mailbox = await import('../../src/crew/mailbox.js');
    app = await (await import('../../src/app.js')).buildApp();
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'andrew@xanderia.com.my', password: 'Admin-password-123' } });
    expect(login.statusCode).toBe(200);
    adminCookie = cookieOf(login);
    adminId = (await db.query(`SELECT id FROM users WHERE email = 'andrew@xanderia.com.my'`)).rows[0].id;
  });

  afterAll(async () => {
    await app?.close();
    await db?.end();
    await (await import('../../src/db/pool.js')).pool.end();
    (await import('../../src/redis.js')).redis.disconnect();
  });

  it('creating a user emails a welcome with the system link and a temporary password, from the admin', async () => {
    const dept = (await db.query(`SELECT id FROM departments LIMIT 1`)).rows[0].id;
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: { cookie: adminCookie },
      payload: { email: 'Aina.Test@xanderia.com.my', display_name: 'Aina', department_id: dept },
    });
    expect(res.statusCode).toBe(200);
    const r = res.json();
    newUserId = r.id;
    tempPassword = r.invite.tempPassword;
    expect(r.invite).toMatchObject({ kind: 'welcome', link: 'https://council.test/', blocked: false, held: true, emailed: false });
    const mail = (await db.query(`SELECT * FROM outbound_emails WHERE to_email = 'aina.test@xanderia.com.my'`)).rows[0];
    expect(mail).toMatchObject({ kind: 'account', status: 'queued', sender_user_id: adminId });
    expect(mail.body_text).toContain(tempPassword);
    expect(mail.body_text).toContain('https://council.test/');
    const u = (await db.query(`SELECT must_change_password, temp_password_expires_at FROM users WHERE id = $1`, [newUserId])).rows[0];
    expect(u.must_change_password).toBe(true);
    expect(new Date(u.temp_password_expires_at).getTime()).toBeGreaterThan(Date.now() + 6 * 86400_000);
  });

  it('holds the welcome until the admin connects their own mailbox', async () => {
    await crew.sendQueuedEmails(new Date(), ms.fetchImpl);
    expect((await db.query(`SELECT status FROM outbound_emails WHERE to_email = 'aina.test@xanderia.com.my'`)).rows[0].status).toBe('queued');
    expect(ms.calls).toHaveLength(0);
    const me = (await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: adminCookie } })).json();
    expect(me.mailbox).toMatchObject({ configured: true, connected: false, held: 1 });
  });

  it('connects through Microsoft sign-in (PKCE, single-use state) and then sends as the admin', async () => {
    const start = await app.inject({ method: 'GET', url: '/api/auth/microsoft/start', headers: { cookie: adminCookie } });
    const auth = new URL(start.json().url);
    expect(auth.origin + auth.pathname).toBe('https://login.microsoftonline.com/tenant-1/oauth2/v2.0/authorize');
    expect(auth.searchParams.get('scope')).toBe('offline_access User.Read Mail.Send');
    expect(auth.searchParams.get('redirect_uri')).toBe('https://council.test/api/auth/microsoft/callback');
    expect(auth.searchParams.get('code_challenge_method')).toBe('S256');
    const state = auth.searchParams.get('state')!;

    await mailbox.completeConnect('code-abc', state, ms.fetchImpl);
    const tokenCall = ms.calls.find((c) => c.url.endsWith('/token'))!;
    expect(tokenCall.body).toMatchObject({ grant_type: 'authorization_code', code: 'code-abc', client_secret: 'secret-1' });
    expect(tokenCall.body.code_verifier.length).toBeGreaterThan(40);
    await expect(mailbox.completeConnect('code-abc', state, ms.fetchImpl)).rejects.toThrow(/expired/);

    const row = (await db.query(`SELECT * FROM user_mailboxes WHERE user_id = $1`, [adminId])).rows[0];
    expect(row).toMatchObject({ address: 'andrew@xanderia.com.my', status: 'ok' });
    expect(row.refresh_token_enc).not.toContain('refresh-');

    await crew.sendQueuedEmails(new Date(), ms.fetchImpl);
    const send = ms.calls.find((c) => c.url.endsWith('/me/sendMail'))!;
    expect(send.auth).toMatch(/^Bearer access-/);
    expect(send.body.message.toRecipients[0].emailAddress.address).toBe('aina.test@xanderia.com.my');
    expect(send.body.saveToSentItems).toBe(true);
    expect((await db.query(`SELECT status, provider FROM outbound_emails WHERE to_email = 'aina.test@xanderia.com.my'`)).rows[0]).toEqual({ status: 'sent', provider: 'microsoft' });
  });

  it('the callback redirects home with an error for a bad state, without a session cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/microsoft/callback?code=x&state=nope' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toMatch(/^\/\?mailbox_error=/);
    const denied = await app.inject({ method: 'GET', url: '/api/auth/microsoft/callback?error=access_denied' });
    expect(decodeURIComponent(String(denied.headers.location))).toContain('cancelled');
  });

  it('the temporary password signs in but only to choose a new password', async () => {
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'aina.test@xanderia.com.my', password: tempPassword } });
    expect(login.json()).toEqual({ ok: true, mustChangePassword: true });
    const cookie = cookieOf(login);
    const me = (await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })).json();
    expect(me.mustChangePassword).toBe(true);
    const blocked = await app.inject({ method: 'GET', url: '/api/conversations', headers: { cookie } });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().code).toBe('must_change_password');
    const same = await app.inject({ method: 'POST', url: '/api/auth/password', headers: { cookie }, payload: { current: tempPassword, next: tempPassword } });
    expect(same.statusCode).toBe(400);
    const ok = await app.inject({ method: 'POST', url: '/api/auth/password', headers: { cookie }, payload: { current: tempPassword, next: 'Aina-own-password-1' } });
    expect(ok.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/conversations', headers: { cookie } })).statusCode).toBe(200);
  });

  it('an expired temporary password is refused', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/admin/users/${newUserId}/invite`, headers: { cookie: adminCookie } });
    // Aina now has her own password, so this is a reset link, not a new temporary password.
    expect(res.json().kind).toBe('reset');
    await db.query(`UPDATE users SET must_change_password = true, temp_password_expires_at = now() - interval '1 minute' WHERE id = $1`, [newUserId]);
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'aina.test@xanderia.com.my', password: 'Aina-own-password-1' } });
    expect(login.statusCode).toBe(401);
    expect(login.json().error).toMatch(/temporary password has expired/);
    const again = await app.inject({ method: 'POST', url: `/api/admin/users/${newUserId}/invite`, headers: { cookie: adminCookie } });
    expect(again.json()).toMatchObject({ kind: 'welcome', held: false });
  });

  it('when Microsoft refuses the refresh token, emails wait, the user is told once, and reconnecting releases them', async () => {
    await db.query(`UPDATE user_mailboxes SET access_expires_at = now() - interval '1 minute'`);
    await db.query(`UPDATE outbound_emails SET status = 'sent' WHERE status = 'queued'`);
    for (const to of ['one@xanderia.com.my', 'two@xanderia.com.my']) {
      await db.query(`INSERT INTO outbound_emails (kind, to_email, subject, body_text, body_html, sender_user_id) VALUES ('account', $1, 's', 't', '<p>h</p>', $2)`, [to, adminId]);
    }
    ms.failRefresh();
    await crew.sendQueuedEmails(new Date(), ms.fetchImpl);
    expect((await db.query(`SELECT status FROM user_mailboxes WHERE user_id = $1`, [adminId])).rows[0].status).toBe('expired');
    const waiting = (await db.query(`SELECT status, error FROM outbound_emails WHERE to_email IN ('one@xanderia.com.my', 'two@xanderia.com.my')`)).rows;
    expect(waiting.map((w) => w.status)).toEqual(['queued', 'queued']);
    expect((await db.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND kind = 'mailbox_expired'`, [adminId])).rows[0].n).toBe(1);
    // Next runs skip them without calling Microsoft again.
    const before = ms.calls.length;
    await crew.sendQueuedEmails(new Date(), ms.fetchImpl);
    expect(ms.calls.length).toBe(before);
    const me = (await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: adminCookie } })).json();
    expect(me.mailbox).toMatchObject({ connected: false, status: 'expired', held: 2 });

    const state = new URL((await app.inject({ method: 'GET', url: '/api/auth/microsoft/start', headers: { cookie: adminCookie } })).json().url).searchParams.get('state')!;
    await mailbox.completeConnect('code-2', state, ms.fetchImpl);
    await crew.sendQueuedEmails(new Date(), ms.fetchImpl);
    const sent = (await db.query(`SELECT status FROM outbound_emails WHERE to_email IN ('one@xanderia.com.my', 'two@xanderia.com.my')`)).rows;
    expect(sent.map((w) => w.status)).toEqual(['sent', 'sent']);
  });

  it('without a sender (forgot password) the email uses MAIL_PROVIDER, not a mailbox', async () => {
    await app.inject({ method: 'POST', url: '/api/auth/forgot', payload: { email: 'aina.test@xanderia.com.my' } });
    const before = ms.calls.length;
    await crew.sendQueuedEmails(new Date(), ms.fetchImpl);
    const row = (await db.query(`SELECT status, provider, sender_user_id FROM outbound_emails WHERE to_email = 'aina.test@xanderia.com.my' ORDER BY created_at DESC LIMIT 1`)).rows[0];
    expect(row).toEqual({ status: 'logged', provider: 'outbox', sender_user_id: null });
    expect(ms.calls.length).toBe(before);
  });
});
