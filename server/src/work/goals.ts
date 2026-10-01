import { startCouncil } from '../council/start.js';
import { query } from '../db/pool.js';

/**
 * Quarterly goals. "Plan with the council" asks the council for a plan per department; once the
 * verdict is put into action, the goal's progress is its tasks done plus the metric moving from
 * the baseline towards the target (entered by hand, or read from the latest portfolio snapshot).
 */
export interface GoalRow {
  id: string;
  title: string;
  description: string;
  quarter: string;
  department_id: string | null;
  owner_id: string | null;
  metric_source: 'manual' | 'npl_ratio' | 'par30';
  metric: string;
  unit: string;
  baseline: string | null; // numeric comes back as text
  target: string | null;
  current: string | null;
  status: string;
  message_id: string | null;
}

/** How far the metric has moved from the baseline to the target, 0-100 (works for targets below the baseline too). */
export function metricProgress(baseline: number | null, target: number | null, current: number | null) {
  if (baseline == null || target == null || current == null || baseline === target) return null;
  const p = ((current - baseline) / (target - baseline)) * 100;
  return Math.max(0, Math.min(100, Math.round(p)));
}

export function currentQuarter(date = new Date(Date.now() + 8 * 3600_000)) {
  return `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
}

/** Goals this user can see, with progress. Company-wide goals are visible to everyone. */
export async function listGoals(user: { id: string; role: string; department_id: string }, quarter: string) {
  const { rows } = await query(
    `SELECT g.*, d.name AS department, u.display_name AS owner,
            m.conversation_id, m.status AS council_status,
            (SELECT count(*) FROM action_tasks t JOIN action_plans p ON p.id = t.plan_id
              WHERE g.message_id IS NOT NULL AND p.message_id = g.message_id AND t.status <> 'cancelled')::int AS tasks_total,
            (SELECT count(*) FROM action_tasks t JOIN action_plans p ON p.id = t.plan_id
              WHERE g.message_id IS NOT NULL AND p.message_id = g.message_id AND t.status = 'done')::int AS tasks_done,
            (SELECT p.id FROM action_plans p WHERE g.message_id IS NOT NULL AND p.message_id = g.message_id LIMIT 1) AS plan_id
       FROM goals g
       LEFT JOIN departments d ON d.id = g.department_id
       LEFT JOIN users u ON u.id = g.owner_id
       LEFT JOIN messages m ON m.id = g.message_id
      WHERE g.quarter = $1 AND ($2 = 'admin' OR g.department_id IS NULL OR g.department_id = $3)
      ORDER BY g.department_id NULLS FIRST, g.created_at`,
    [quarter, user.role, user.department_id],
  );
  const { rows: snap } = await query(
    `SELECT month, (summary->>'nplRatio')::float AS npl, (summary->'par'->>'par30')::float AS par30 FROM portfolio_snapshots ORDER BY month DESC LIMIT 1`,
  );
  return rows.map((g) => {
    const num = (v: string | null) => (v == null ? null : Number(v));
    // Portfolio metrics come from the latest saved month, as a percentage.
    const fromPortfolio = g.metric_source !== 'manual' && snap[0] ? Number(((g.metric_source === 'npl_ratio' ? snap[0].npl : snap[0].par30) * 100).toFixed(2)) : null;
    const current = fromPortfolio ?? num(g.current);
    return {
      ...g,
      baseline: num(g.baseline),
      target: num(g.target),
      current,
      current_from: fromPortfolio != null ? `portfolio ${snap[0].month}` : null,
      metric_progress: metricProgress(num(g.baseline), num(g.target), current),
      task_progress: g.tasks_total ? Math.round((g.tasks_done / g.tasks_total) * 100) : null,
    };
  });
}

export function goalQuestion(g: Pick<GoalRow, 'title' | 'description' | 'quarter' | 'metric' | 'unit' | 'baseline' | 'target' | 'current'>, scope: string) {
  const u = g.unit ? ` ${g.unit}` : '';
  const figures =
    g.metric && g.target != null
      ? `\nMeasure: ${g.metric}, from ${g.baseline ?? 'the current level'}${g.baseline != null ? u : ''} to ${g.target}${u} by the end of ${g.quarter}.${g.current != null ? ` Latest figure: ${g.current}${u}.` : ''}`
      : '';
  return (
    `Quarterly goal for ${scope}, ${g.quarter}: ${g.title}.${g.description ? `\n${g.description}` : ''}${figures}\n\n` +
    'Plan how we reach this goal this quarter: the milestones, which department and role owns each one, the order and the weeks, ' +
    'and how we will know each month whether we are on track.'
  );
}

export async function planGoal(goalId: string, user: { id: string; department_id: string }) {
  const { rows } = await query(`SELECT g.*, d.name AS department FROM goals g LEFT JOIN departments d ON d.id = g.department_id WHERE g.id = $1`, [goalId]);
  const g = rows[0] as (GoalRow & { department: string | null }) | undefined;
  if (!g) throw Object.assign(new Error('Goal not found'), { statusCode: 404 });
  const r = await startCouncil({
    userId: user.id,
    departmentId: g.department_id ?? user.department_id,
    title: `Goal ${g.quarter}: ${g.title}`,
    question: goalQuestion(g, g.department ?? 'the whole company'),
    purpose: 'goal',
  });
  await query(`UPDATE goals SET message_id = $2, updated_at = now() WHERE id = $1`, [goalId, r.messageId]);
  return r;
}
