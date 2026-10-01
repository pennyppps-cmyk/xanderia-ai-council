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
    // Requests that look unlawful/unethical are flagged for Compliance (the answer still comes, with a warning).
    red_flag: z.enum(['none', 'harassment', 'data_misuse', 'fraud', 'discrimination', 'other']).default('none'),
    red_flag_reason: z.string().default(''),
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
  // What every answer missed: the collective blind spot the Chairman reports.
  all_missed: z.string().default(''),
});
export type ReviewOutput = z.infer<typeof ReviewSchema>;

/** Stage 3 Chairman verdict — the structured output shown on top of every council answer. */
export const VerdictSchema = z.object({
  verdict: z.string(),
  why: z.string(),
  // Points several advisors reached independently: the high-confidence signals.
  agreements: z.array(z.string()).default([]),
  conflicts: z.array(
    z.object({
      between: z.string(),
      position_a: z.string(),
      position_b: z.string(),
      decision: z.string(),
      because: z.string(),
    }),
  ),
  // What only surfaced in peer review, or what every advisor missed.
  blind_spots: z.array(z.string()).default([]),
  // The single concrete step to take first (not a list).
  first_step: z.string().default(''),
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
  // Numeric targets that show whether the decision worked; the decision check-ins ask about them.
  success_measures: z
    .array(
      z.object({
        measure: z.string(),
        baseline: z.string().default(''),
        target: z.string(),
        check_after_days: z.number().int().min(7).max(365).default(60),
      }),
    )
    .max(5)
    .default([]),
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

/** Action Crew — Dispatcher: the verdict's action plan as owned, dated, ordered tasks. */
export const DispatchSchema = z.object({
  tasks: z
    .array(
      z.object({
        title: z.string(),
        description: z.string(),
        owner_type: z.enum(['human', 'agent']),
        owner_role: z.string(),
        due_in_working_days: z.number().int().min(1).max(260),
        depends_on: z.array(z.number().int().min(1)),
        // Positions the owner should work with (input, data, sign-off). Resolved against the directory.
        work_with: z.array(z.string()).max(3).default([]),
      }),
    )
    .min(1),
});
export type DispatchOutput = z.infer<typeof DispatchSchema>;

/** A written SOP → a recurring routine the owner checks before saving. */
export const RoutineDraftSchema = z.object({
  name: z.string(),
  frequency: z.enum(['weekly', 'monthly', 'quarterly']),
  run_day: z.number().int().min(1).max(20),
  steps: z
    .array(
      z.object({
        title: z.string(),
        description: z.string(),
        owner_role: z.string(),
        owner_type: z.enum(['human', 'agent']),
        due_day: z.number().int().min(1).max(60),
        depends_on: z.array(z.number().int().min(1)),
      }),
    )
    .min(1),
});
export type RoutineDraft = z.infer<typeof RoutineDraftSchema>;

/** Meeting notes or a transcript → minutes with owned action items. */
export const MinutesSchema = z.object({
  summary: z.string(),
  decisions: z.array(z.string()),
  actions: z.array(
    z.object({
      task: z.string(),
      // The person or role named in the notes ("Aina", "Head of IT"); '' when nobody was named.
      owner: z.string(),
      // YYYY-MM-DD when the notes give a date or a deadline that can be worked out; otherwise ''.
      due_date: z.string(),
      // The deadline exactly as said ("next Friday", "12 Oct", "end of month"); '' if none. Weekdays are
      // worked out in code: the model gets them wrong.
      due_said: z.string().default(''),
    }),
  ),
  open_points: z.array(z.string()),
});
export type Minutes = z.infer<typeof MinutesSchema>;
