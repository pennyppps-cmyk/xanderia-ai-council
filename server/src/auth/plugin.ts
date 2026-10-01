import fp from 'fastify-plugin';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { roleAtLeast, type UserRole } from '../settings.js';

export const SESSION_COOKIE = 'xc_session';

export interface SessionUser {
  id: string;
  email: string;
  display_name: string;
  role: UserRole;
  department_id: string;
  locale: string;
  /** Signed in with a temporary password: only /api/auth/* works until they choose their own. */
  must_change_password: boolean;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string };
    user: SessionUser;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (min: UserRole) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export default fp(async (app) => {
  await app.register(cookie);
  await app.register(jwt, {
    secret: config.JWT_SECRET,
    cookie: { cookieName: SESSION_COOKIE, signed: false },
    sign: { expiresIn: '12h' },
  });

  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    let sub: string;
    try {
      sub = (await req.jwtVerify<{ sub: string }>({ onlyCookie: true })).sub;
    } catch {
      return reply.code(401).send({ error: 'Not signed in' });
    }
    // Re-read the user every request so deactivation and role changes apply immediately.
    const { rows } = await query<SessionUser>(
      `SELECT id, email, display_name, role, department_id, locale, must_change_password
         FROM users WHERE id = $1 AND is_active`,
      [sub],
    );
    if (!rows[0]) return reply.code(401).send({ error: 'Not signed in' });
    req.user = rows[0];
    if (rows[0].must_change_password && !req.url.startsWith('/api/auth/')) {
      return reply.code(403).send({ error: 'Choose your own password first', code: 'must_change_password' });
    }
  });

  app.decorate('requireRole', (min: UserRole) => async (req: FastifyRequest, reply: FastifyReply) => {
    await app.authenticate(req, reply);
    if (reply.sent) return;
    if (!roleAtLeast(req.user.role, min)) return reply.code(403).send({ error: 'Forbidden' });
  });
});

/** Rate-limit key: the session's user id (decoded, not verified — auth rejects forgeries anyway). */
export function userKey(app: { jwt: { decode: (t: string) => any } }, req: FastifyRequest) {
  const token = req.cookies?.[SESSION_COOKIE];
  const sub = token ? app.jwt.decode(token)?.sub : undefined;
  return sub ? `user:${sub}` : `ip:${req.ip}`;
}
