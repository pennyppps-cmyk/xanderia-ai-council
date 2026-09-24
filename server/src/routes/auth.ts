import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { writeAudit } from '../audit.js';
import { SESSION_COOKIE } from '../auth/plugin.js';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { canUseCouncil } from '../settings.js';
import { hashToken, lookupPasswordToken, sendAccountLink } from '../account.js';

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
        `SELECT id, password_hash, is_active FROM users WHERE lower(email) = lower($1)`,
        [body.email],
      );
      const user = rows[0];
      const ok = await bcrypt.compare(body.password, user?.password_hash ?? DUMMY_HASH);
      if (!user || !user.is_active || !user.password_hash || !ok) {
        await writeAudit({ action: 'login_failed', detail: { email: body.email.toLowerCase() }, ip: req.ip });
        return reply.code(401).send({ error: 'Invalid email or password' });
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
      return { ok: true };
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
      await query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [t.user_id, await bcrypt.hash(body.password, 12)]);
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
    await query('UPDATE users SET password_hash = $2 WHERE id = $1', [req.user.id, await bcrypt.hash(body.next, 12)]);
    await writeAudit({ actorUserId: req.user.id, action: 'password_changed', detail: {}, ip: req.ip });
    return { ok: true };
  });
}
