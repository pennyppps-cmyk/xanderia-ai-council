import type { Queryable } from '../db/pool.js';

/**
 * Monthly improvement report: where the council is weak and what would make it better.
 * Counts and the feedback comments people chose to write; never the text of staff questions.
 */
export async function improvementReport(db: Queryable, days = 30) {
  const one = async (sql: string, params: unknown[] = [days]) => (await db.query(sql, params)).rows;
  const [feedback, comments, noSources, pending, noOutcome, stale, memory, latency] = await Promise.all([
    one(`SELECT COALESCE(dep.name, '(none)') AS department,
                count(*) FILTER (WHERE f.rating = 1)::int AS helpful, count(*) FILTER (WHERE f.rating = -1)::int AS unhelpful
           FROM feedback f JOIN messages m ON m.id = f.message_id LEFT JOIN departments dep ON dep.id = m.department_id
          WHERE f.created_at > now() - make_interval(days => $1)
          GROUP BY 1 ORDER BY unhelpful DESC, helpful DESC`),
    one(`SELECT to_char(f.created_at, 'YYYY-MM-DD') AS date, COALESCE(dep.name, '(none)') AS department, m.mode, f.comment
           FROM feedback f JOIN messages m ON m.id = f.message_id LEFT JOIN departments dep ON dep.id = m.department_id
          WHERE f.rating = -1 AND f.comment IS NOT NULL AND f.comment <> '' AND f.created_at > now() - make_interval(days => $1)
          ORDER BY f.created_at DESC LIMIT 20`),
    // Answers that found nothing in the knowledge base: a sign of missing documents.
    one(`SELECT COALESCE(dep.name, '(none)') AS department, count(*)::int AS answers,
                count(*) FILTER (WHERE m.citations IS NULL OR jsonb_array_length(m.citations) = 0)::int AS without_sources
           FROM messages m LEFT JOIN departments dep ON dep.id = m.department_id
          WHERE m.role = 'assistant' AND m.status = 'done' AND m.mode IN ('quick', 'council')
            AND m.created_at > now() - make_interval(days => $1)
          GROUP BY 1 ORDER BY without_sources DESC`),
    one(`SELECT COALESCE(dep.name, 'Company-wide') AS department, count(*)::int AS n
           FROM approved_answers a LEFT JOIN departments dep ON dep.id = a.department_id
          WHERE a.status = 'suggested' GROUP BY 1 ORDER BY n DESC`, []),
    one(`SELECT count(*)::int AS n FROM decisions d
          WHERE d.status NOT IN ('done', 'dropped') AND d.decided_at < now() - interval '30 days'
            AND NOT EXISTS (SELECT 1 FROM decision_outcomes o WHERE o.decision_id = d.id)`, []),
    one(`SELECT count(*)::int AS n FROM documents d
          WHERE COALESCE(d.reviewed_at, d.created_at) + make_interval(days => d.review_after_days) < now()`, []),
    one(`SELECT (SELECT count(*) FROM approved_answers WHERE status = 'approved')::int AS approved,
                (SELECT count(*) FROM house_rules WHERE is_active)::int AS rules,
                (SELECT count(*) FROM decisions)::int AS decisions,
                (SELECT count(*) FROM decision_outcomes)::int AS outcomes`, []),
    one(`SELECT mode, count(*)::int AS n,
                round(percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM completed_at - created_at)))::int AS p90_seconds
           FROM messages WHERE role = 'assistant' AND status = 'done' AND mode IN ('quick', 'council')
            AND created_at > now() - make_interval(days => $1)
          GROUP BY mode`),
  ]);
  const suggestions: string[] = [];
  const weakest = noSources.find((r) => r.answers >= 5 && r.without_sources / r.answers > 0.6);
  if (weakest) suggestions.push(`${weakest.department}: ${weakest.without_sources} of ${weakest.answers} answers found nothing in the knowledge base. Upload its SOPs and policies.`);
  const unhappy = feedback.find((r) => r.unhelpful >= 3 && r.unhelpful > r.helpful);
  if (unhappy) suggestions.push(`${unhappy.department}: more "not helpful" than "helpful" ratings (${unhappy.unhelpful} vs ${unhappy.helpful}). Read the comments and add house rules or approved answers.`);
  const pendingTotal = pending.reduce((n, r) => n + r.n, 0);
  if (pendingTotal) suggestions.push(`${pendingTotal} suggested answers are waiting for a lead to review (Admin → Company memory).`);
  if (noOutcome[0].n) suggestions.push(`${noOutcome[0].n} decisions older than 30 days have no outcome recorded; outcomes are what the council learns from.`);
  if (stale[0].n) suggestions.push(`${stale[0].n} knowledge documents are past their review date.`);
  if (memory[0].rules === 0) suggestions.push('No house rules yet: ask each department lead to add 3–5 (definitions, limits, policies).');
  return { days, feedback, comments, noSources, pending, noOutcome: noOutcome[0].n, stale: stale[0].n, memory: memory[0], latency, suggestions };
}

export function improvementReportText(r: Awaited<ReturnType<typeof improvementReport>>) {
  const lines = [
    `Xanderia AI Council: improvement report for the last ${r.days} days.`,
    `COMPANY MEMORY: ${r.memory.rules} house rules, ${r.memory.approved} approved answers, ${r.memory.decisions} decisions (${r.memory.outcomes} outcomes recorded).`,
    `FEEDBACK: ${r.feedback.map((f) => `${f.department} ${f.helpful} helpful / ${f.unhelpful} not helpful`).join('; ') || 'none'}.`,
    `ANSWERS WITHOUT SOURCES: ${r.noSources.map((s) => `${s.department} ${s.without_sources}/${s.answers}`).join('; ') || 'none'}.`,
    `SPEED (90% of answers within): ${r.latency.map((l) => `${l.mode} ${l.p90_seconds}s (${l.n} answers)`).join('; ') || 'no answers'}.`,
  ];
  if (r.suggestions.length) lines.push(`WHAT TO DO:\n${r.suggestions.map((s) => `• ${s}`).join('\n')}`);
  if (r.comments.length) lines.push(`RECENT "NOT HELPFUL" COMMENTS:\n${r.comments.slice(0, 10).map((c) => `• ${c.date}, ${c.department}: ${c.comment}`).join('\n')}`);
  return lines;
}
