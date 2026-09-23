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
        // Numeric schedule for the report's timeline chart (week 1 = the week the plan starts).
        start_week: z.number().int().min(1).max(104),
        duration_weeks: z.number().int().min(1).max(104),
      }),
    )
    .min(1),
  risks: z.array(
    z.object({
      risk: z.string(),
      likelihood: z.enum(['low', 'medium', 'high']),
      impact: z.enum(['low', 'medium', 'high']),
      mitigation: z.string(),
    }),
  ),
  open_questions: z.array(z.string()),
  confidence: z.object({
    level: z.enum(['low', 'medium', 'high']),
    what_would_change: z.string(),
  }),
});
export type Verdict = z.infer<typeof VerdictSchema>;

/** Intake check before convening the council: is anything essential missing? */
export const ClarifySchema = z.object({
  needs_clarification: z.boolean(),
  // No max here: a model that returns 4 questions should not lose all of them; the code keeps the first 3.
  questions: z.array(z.string()),
  assumptions_if_skipped: z.array(z.string()),
});
export type ClarifyOutput = z.infer<typeof ClarifySchema>;
