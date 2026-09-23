import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signed, expiring tokens for the one-click links in task emails, so the recipient
 * does not need to log in. A token only authorises status changes on its own task.
 */
const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url');

function sign(payload: string, secret: string) {
  return createHmac('sha256', `task-link:${secret}`).update(payload).digest().subarray(0, 18);
}

export function signTaskToken(taskId: string, secret: string, ttlDays = 45, now = Date.now()) {
  const payload = b64(JSON.stringify({ t: taskId, e: Math.floor(now / 1000) + ttlDays * 86400 }));
  return `${payload}.${b64(sign(payload, secret))}`;
}

export function verifyTaskToken(token: string, secret: string, now = Date.now()): { taskId: string } | null {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload, secret);
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const { t, e } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof t !== 'string' || typeof e !== 'number' || e * 1000 < now) return null;
    return { taskId: t };
  } catch {
    return null;
  }
}
