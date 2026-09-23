import { z } from 'zod';

/** Router / intake classification. Department enum is built per call from active departments. */
export function routerSchema(departmentSlugs: [string, ...string[]]) {
  return z.object({
    department: z.enum(departmentSlugs),
    intent: z.enum(['question', 'plan', 'decision']),
    contains_pii: z.boolean(),
    sensitivity: z.enum(['low', 'high']),
    suggested_mode: z.enum(['quick', 'council']),
    language: z.enum(['en', 'ms']),
    reason: z.string(),
  });
}
export type RouterOutput = z.infer<ReturnType<typeof routerSchema>>;

/** Stage 2 peer review: one entry per other advisor, forced to name a flaw and score 1–5. */
export const ReviewSchema = z.object({
  reviews: z
    .array(
      z.object({
        advisor: z.string(),
        biggest_flaw: z.string(),
        score: z.number().int().min(1).max(5),
      }),
    )
    .min(1),
  strongest: z.string(),
});
export type ReviewOutput = z.infer<typeof ReviewSchema>;

/** Stage 3 Chairman verdict — the structured output shown on top of every council answer. */
export const VerdictSchema = z.object({
  verdict: z.string(),
  why: z.string(),
  conflicts: z.array(
    z.object({
      between: z.string(),
      position_a: z.string(),
      position_b: z.string(),
      decision: z.string(),
      because: z.string(),
    }),
  ),
  action_plan: z
    .array(
      z.object({
        step: z.string(),
        owner_role: z.string(),
        timeline: z.string(),
      }),
    )
    .min(1),
  risks: z.array(z.object({ risk: z.string(), mitigation: z.string() })),
  open_questions: z.array(z.string()),
  confidence: z.object({
    level: z.enum(['low', 'medium', 'high']),
    what_would_change: z.string(),
  }),
});
export type Verdict = z.infer<typeof VerdictSchema>;
