import type { FastifyInstance } from 'fastify';
import { query } from '../db/pool.js';
import { onboardingFor } from '../onboarding.js';

export default async function onboardingRoutes(app: FastifyInstance) {
  const auth = { preHandler: app.authenticate };

  /** The signed-in person's checklist (admins have none). */
  app.get('/api/onboarding', auth, async (req) => {
    if (req.user.role === 'admin') return { items: [], done: 0, total: 0, complete: true, dismissed: true };
    return onboardingFor(req.user);
  });

  /** Hide the card (it comes back if a department lead still has setup steps when reminded). */
  app.post('/api/onboarding/dismiss', auth, async (req) => {
    await query(`UPDATE users SET onboarding_dismissed_at = now() WHERE id = $1`, [req.user.id]);
    return { ok: true };
  });

  /** Admins: every department lead's setup progress. */
  app.get('/api/admin/onboarding', { preHandler: app.requireRole('admin') }, async () => {
    const { rows } = await query(
      `SELECT u.id, u.display_name, u.email, u.role, u.department_id, d.name AS department_name, u.last_login_at, u.onboarding_reminders
         FROM users u LEFT JOIN departments d ON d.id = u.department_id
        WHERE u.is_active AND u.role = 'dept_lead' AND u.department_id IS NOT NULL
        ORDER BY d.name, u.display_name`,
    );
    const out = [];
    for (const u of rows) {
      const o = await onboardingFor(u);
      out.push({
        id: u.id,
        name: u.display_name,
        email: u.email,
        department: u.department_name,
        last_login_at: u.last_login_at,
        reminders: u.onboarding_reminders,
        done: o.done,
        total: o.total,
        missing: o.items.filter((i) => !i.done).map((i) => i.title),
      });
    }
    return out;
  });
}
