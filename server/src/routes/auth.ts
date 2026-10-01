import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { writeAudit } from '../audit.js';
import { SESSION_COOKIE } from '../auth/plugin.js';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { canUseCouncil } from '../settings.js';
import { hashToken, lookupPasswordToken, sendAccountLink } from '../account.js';
import { completeConnect, connectUrl, disconnectMailbox, mailboxStatus, msConfigured } from '../crew/mailbox.js';

const Login = z.object({ email: z.string().email(), password: z.string().min(1) });
const ChangePassword = z.object({ current: z.string().min(1), next: z.string().min(10) });

// Compared against when the email is unknown, so response time does not reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

export default async function authRoutes(app: FastifyInstance) {
  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = Login.parse(req.body);
      const { rows } = await query(
        `SELECT id, password_hash, is_active, must_change_password,
                (temp_password_expires_at IS NOT NULL AND temp_password_expires_at < now()) AS temp_expired
           FROM users WHERE lower(email) = lower($1)`,
        [body.email],
      );
      const user = rows[0];
      const ok = await bcrypt.compare(body.password, user?.password_hash ?? DUMMY_HASH);
      if (!user || !user.is_active || !user.password_hash || !ok) {
        await writeAudit({ action: 'login_failed', detail: { email: body.email.toLowerCase() }, ip: req.ip });
        return reply.code(401).send({ error: 'Invalid email or password' });
      }
      if (user.must_change_password && user.temp_expired) {
        await writeAudit({ actorUserId: user.id, action: 'login_failed', detail: { reason: 'temporary_password_expired' }, ip: req.ip });
        return reply.code(401).send({ error: 'Your temporary password has expired. Ask your administrator to send a new one.' });
      }
      await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
      await writeAudit({ actorUserId: user.id, action: 'login', ip: req.ip, detail: {} });
      const token = await reply.jwtSign({ sub: user.id });
      reply.setCookie(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: 'strict',
        secure: config.COOKIE_SECURE,
        path: '/',
        maxAge: 12 * 3600,
      });
      return { ok: true, mustChangePassword: user.must_change_password };
    },
  );

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: app.authenticate }, async (req) => {
    const { rows } = await query(
      `SELECT d.slug, d.name FROM departments d WHERE d.id = $1`,
      [req.user.department_id],
    );
    return {
      user: req.user,
      department: rows[0],
      canUseCouncil: await canUseCouncil(req.user.role),
      mustChangePassword: req.user.must_change_password,
      mailbox: await mailboxStatus(req.user.id),
    };
  });

  /** "Forgot password?": always answers the same, so it never reveals which emails have accounts. */
  app.post(
    '/api/auth/forgot',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (req) => {
      const { email } = z.object({ email: z.string().trim().email() }).parse(req.body);
      const { rows } = await query(`SELECT id FROM users WHERE lower(email) = lower($1) AND is_active`, [email]);
      if (rows[0]) await sendAccountLink(rows[0].id, 'reset').catch((err) => req.log.error(err));
      return { ok: true };
    },
  );

  /** Check an invite / reset link before showing the set-password form. */
  app.get('/api/auth/token/:token', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { token } = z.object({ token: z.string().min(20).max(100) }).parse(req.params);
    const t = await lookupPasswordToken(token);
    if (!t) return reply.code(400).send({ error: 'This link is invalid or has expired. Ask for a new one.' });
    return { purpose: t.purpose, email: t.email, name: t.display_name, locale: t.locale };
  });

  /** Set a password from an invite / reset link, then sign the user in. */
  app.post(
    '/api/auth/set-password',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = z.object({ token: z.string().min(20).max(100), password: z.string().min(10).max(200) }).parse(req.body);
      const t = await lookupPasswordToken(body.token);
      if (!t) return reply.code(400).send({ error: 'This link is invalid or has expired. Ask for a new one.' });
      await query(
        `UPDATE users SET password_hash = $2, must_change_password = false, temp_password_expires_at = NULL WHERE id = $1`,
        [t.user_id, await bcrypt.hash(body.password, 12)],
      );
      // Single use: this link and any other open links for the user stop working.
      await query(`UPDATE password_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [t.user_id]);
      await writeAudit({
        actorUserId: t.user_id,
        action: t.purpose === 'invite' ? 'account_activated' : 'password_reset',
        ip: req.ip,
        detail: { token: hashToken(body.token).slice(0, 12) },
      });
      const jwtToken = await reply.jwtSign({ sub: t.user_id });
      reply.setCookie(SESSION_COOKIE, jwtToken, { httpOnly: true, sameSite: 'strict', secure: config.COOKIE_SECURE, path: '/', maxAge: 12 * 3600 });
      await query('UPDATE users SET last_login_at = now() WHERE id = $1', [t.user_id]);
      return { ok: true };
    },
  );

  app.patch('/api/auth/locale', { preHandler: app.authenticate }, async (req) => {
    const { locale } = z.object({ locale: z.enum(['en', 'ms']) }).parse(req.body);
    await query('UPDATE users SET locale = $2 WHERE id = $1', [req.user.id, locale]);
    return { ok: true };
  });

  app.post('/api/auth/password', { preHandler: app.authenticate }, async (req, reply) => {
    const body = ChangePassword.parse(req.body);
    const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!rows[0]?.password_hash || !(await bcrypt.compare(body.current, rows[0].password_hash))) {
      return reply.code(400).send({ error: 'Current password is incorrect' });
    }
    if (body.next === body.current) return reply.code(400).send({ error: 'Choose a new password, not the temporary one' });
    await query(
      `UPDATE users SET password_hash = $2, must_change_password = false, temp_password_expires_at = NULL WHERE id = $1`,
      [req.user.id, await bcrypt.hash(body.next, 12)],
    );
    await writeAudit({ actorUserId: req.user.id, action: 'password_changed', detail: {}, ip: req.ip });
    return { ok: true };
  });

  // ── Own Microsoft mailbox (emails the user causes are sent from it) ──

  app.get('/api/auth/microsoft/start', { preHandler: app.authenticate }, async (req, reply) => {
    if (!msConfigured()) return reply.code(400).send({ error: 'Microsoft email is not set up yet. Ask your administrator.' });
    return { url: await connectUrl(req.user.id, req.user.email) };
  });

  /**
   * Microsoft redirects here after sign-in. This is a cross-site navigation, so the SameSite=strict
   * session cookie is not sent: the user is identified by the single-use state instead.
   */
  app.get('/api/auth/microsoft/callback', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const q = z
      .object({ code: z.string().max(4000).optional(), state: z.string().max(200).optional(), error: z.string().max(200).optional(), error_description: z.string().max(2000).optional() })
      .parse(req.query);
    const back = (params: Record<string, string>) => reply.redirect(`/?${new URLSearchParams(params)}`);
    if (q.error || !q.code || !q.state) {
      req.log.warn({ error: q.error, description: q.error_description }, 'microsoft connect refused');
      return back({ mailbox_error: q.error === 'access_denied' ? 'You cancelled the Microsoft sign-in.' : (q.error_description ?? q.error ?? 'Sign-in failed').split('\r\n')[0].slice(0, 300) });
    }
    try {
      const r = await completeConnect(q.code, q.state);
      await writeAudit({ actorUserId: r.userId, action: 'mailbox_connected', detail: { address: r.address }, ip: req.ip });
      return back({ mailbox: 'connected' });
    } catch (err) {
      req.log.error(err, 'microsoft connect failed');
      return back({ mailbox_error: (err as Error).message.slice(0, 300) });
    }
  });

  app.delete('/api/auth/microsoft', { preHandler: app.authenticate }, async (req) => {
    await disconnectMailbox(req.user.id);
    await writeAudit({ actorUserId: req.user.id, action: 'mailbox_disconnected', detail: {}, ip: req.ip });
    return { ok: true };
  });
}
