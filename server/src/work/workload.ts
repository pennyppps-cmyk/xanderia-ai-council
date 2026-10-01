import { writeAudit } from '../audit.js';
import { klParts } from '../crew/calendar.js';
import { notify, queueTaskEmail } from '../crew/service.js';
import { query, tx } from '../db/pool.js';
import { getSetting } from '../settings.js';

/**
 * Who is carrying how much: open and overdue tasks per person, whether they are away, and a
 * less loaded colleague in the same position (or department) when someone is overloaded.
 */
export interface Load {
  id: string;
  name: string;
  position: string;
  department_id: string | null;
  open: number;
  overdue: number;
  due_this_week: number;
  away_until: string | null;
  backup_id: string | null;
}

export interface OverloadLimits {
  open: number;
  overdue: number;
}
export const DEFAULT_OVERLOAD: OverloadLimits = { open: 8, overdue: 3 };

const OPEN = `('sent', 'accepted', 'in_progress', 'blocked')`;

export async function loadWorkload(filter: { ids?: string[]; departmentId?: string } = {}): Promise<Load[]> {
  const today = klParts(new Date()).date;
  const { rows } = await query(
    `SELECT s.id, s.name, s.position, s.department_id, to_char(s.away_until, 'YYYY-MM-DD') AS away_until, s.backup_id,
            count(t.id) FILTER (WHERE t.status IN ${OPEN})::int AS open,
            count(t.id) FILTER (WHERE t.status IN ${OPEN} AND t.due_date < $1::date)::int AS overdue,
            count(t.id) FILTER (WHERE t.status IN ${OPEN} AND t.due_date BETWEEN $1::date AND $1::date + 6)::int AS due_this_week
       FROM staff_directory s
       LEFT JOIN action_tasks t ON t.directory_id = s.id AND t.owner_type = 'human'
       LEFT JOIN action_plans p ON p.id = t.plan_id AND p.status = 'launched'
      WHERE s.is_active AND ($2::uuid[] IS NULL OR s.id = ANY($2::uuid[])) AND ($3::uuid IS NULL OR s.department_id = $3)
        AND (t.id IS NULL OR p.id IS NOT NULL)
      GROUP BY s.id ORDER BY s.name`,
    [today, filter.ids ?? null, filter.departmentId ?? null],
  );
  return rows;
}

export function isOverloaded(l: Pick<Load, 'open' | 'overdue'>, limits: OverloadLimits) {
  return l.open >= limits.open || l.overdue >= limits.overdue;
}

/** A colleague who could take the work instead: same position first, then same department; least loaded. */
export function suggestAlternative(person: Load, everyone: Load[], limits: OverloadLimits, onDate: string): Load | null {
  const free = (l: Load) => l.id !== person.id && !isOverloaded(l, limits) && !(l.away_until && l.away_until >= onDate);
  const byLoad = (a: Load, b: Load) => a.open + a.overdue * 2 - (b.open + b.overdue * 2);
  const samePosition = everyone.filter((l) => free(l) && l.position.toLowerCase() === person.position.toLowerCase()).sort(byLoad);
  if (samePosition.length) return samePosition[0];
  const sameDept = everyone.filter((l) => free(l) && person.department_id && l.department_id === person.department_id).sort(byLoad);
  return sameDept[0] ?? null;
}

export const overloadLimits = () => getSetting<OverloadLimits>('crew_overload', DEFAULT_OVERLOAD);

/**
 * Hands every open task of one person to another (leave, resignation). Tasks already sent are
 * sent again to the new owner; requesters are told.
 */
export async function handOver(fromId: string, toId: string, actorUserId: string) {
  if (fromId === toId) throw Object.assign(new Error('Choose someone else'), { statusCode: 400 });
  const { rows: people } = await query(`SELECT id, name FROM staff_directory WHERE id = ANY($1::uuid[]) AND is_active`, [[fromId, toId]]);
  const from = people.find((p) => p.id === fromId);
  const to = people.find((p) => p.id === toId);
  if (!from || !to) throw Object.assign(new Error('Both people must be active in the staff directory'), { statusCode: 400 });

  const moved = await tx(async (c) => {
    const { rows } = await c.query(
      `UPDATE action_tasks t SET directory_id = $2, resolution = 'resolved', acknowledged_at = NULL,
              ack_reminded_at = NULL, due_reminded_at = NULL, nudged_at = NULL, escalation_state = 'none', updated_at = now()
        WHERE t.directory_id = $1 AND t.owner_type = 'human' AND t.status IN ('draft', 'sent', 'accepted', 'in_progress', 'blocked')
       RETURNING t.id, t.status, t.title, t.plan_id`,
      [fromId, toId],
    );
    for (const r of rows) {
      await c.query(`INSERT INTO task_events (task_id, kind, actor, detail) VALUES ($1, 'handed_over', $2, $3)`, [
        r.id,
        `user:${actorUserId}`,
        JSON.stringify({ from: from.name, to: to.name }),
      ]);
    }
    return rows;
  });
  for (const t of moved) {
    if (t.status === 'draft') continue;
    // The new owner gets the task as a fresh one to accept.
    await query(`UPDATE action_tasks SET status = 'sent', sent_at = now() WHERE id = $1`, [t.id]);
    await queueTaskEmail(t.id, 'task').catch(() => {});
  }
  const byPlan = new Map<string, number>();
  for (const t of moved) byPlan.set(t.plan_id, (byPlan.get(t.plan_id) ?? 0) + 1);
  for (const [planId, n] of byPlan) {
    const { rows } = await query(`SELECT requester_id FROM action_plans WHERE id = $1`, [planId]);
    if (rows[0] && rows[0].requester_id !== actorUserId) {
      await notify(rows[0].requester_id, { kind: 'task_handed_over', title: `${n} task(s) moved from ${from.name} to ${to.name}`, link: `/plans/${planId}` });
    }
  }
  await writeAudit({ actorUserId, action: 'tasks_handed_over', targetType: 'staff_directory', targetId: fromId, detail: { to: toId, tasks: moved.length } });
  return { moved: moved.length };
}
