import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseStance } from '../src/council/format.js';
import { planWeeks, renderReport, type ReportData } from '../src/report/councilReport.js';
import type { Verdict } from '../src/llm/schemas.js';

const verdict: Verdict = {
  verdict: 'Pilot branch-level approval of top-up loans under RM 3,000 in two branches for 8 weeks, with head-office sampling of 20% of approvals.',
  why: 'Faster approvals are the main customer complaint, and the risk is limited by amount and repayment history. A pilot with sampling tests whether branch decisions match head office before a wider rollout.',
  agreements: ['Approval speed is the main complaint (Customer Advocate, Executor, Expansionist).'],
  blind_spots: ['Nobody said how branch staff are trained to judge top-ups.'],
  first_step: 'Credit head picks the two pilot branches this week.',
  conflicts: [
    {
      between: 'The Contrarian vs The Expansionist',
      position_a: 'Branch approvals weaken credit control and invite fraud.',
      position_b: 'Branch approvals free head-office capacity and lift top-up volume.',
      decision: 'Pilot with controls.',
      because: 'The fraud risk is bounded by the RM 3,000 cap and 20% sampling catches drift early.',
    },
  ],
  action_plan: [
    { step: 'Write approval criteria and limits for branch staff', owner_role: 'Head of Credit', timeline: 'Week 1-2', start_week: 1, duration_weeks: 2 },
    { step: 'Train branch managers in the two pilot branches', owner_role: 'HR Manager', timeline: 'Week 3', start_week: 3, duration_weeks: 1 },
    { step: 'Run the pilot with 20% head-office sampling', owner_role: 'Branch Manager', timeline: 'Weeks 4-11', start_week: 4, duration_weeks: 8 },
    { step: 'Review default and complaint data; decide on rollout', owner_role: 'Head of Credit', timeline: 'Week 12', start_week: 12, duration_weeks: 1 },
  ],
  risks: [
    { risk: 'Inconsistent approval standards between branches', likelihood: 'medium', impact: 'high', mitigation: 'Written criteria plus 20% head-office sampling.' },
    { risk: 'Staff collusion or fraud', likelihood: 'low', impact: 'high', mitigation: 'Dual sign-off above RM 2,000; audit trail.' },
    { risk: 'Slower branch service during training', likelihood: 'medium', impact: 'low', mitigation: 'Train outside peak hours.' },
  ],
  open_questions: ['What is the current default rate on top-up loans?', 'Which two branches have the most top-up requests?'],
  success_measures: [{ measure: 'Top-up approval rate', baseline: '18%', target: 'at least 25%', check_after_days: 60 }],
  confidence: { level: 'medium', what_would_change: 'Pilot default rates above the head-office baseline.' },
};

const opinion = (position: string, stance: string) =>
  `**Position:** ${position}\n\n**Key points:**\n- Point one about **controls**.\n- Point two.\n\n**Recommendation:** Do it carefully.\n\n**Stance:** ${stance}`;

const data: ReportData = {
  title: 'Should branch staff approve small top-up loans?',
  question: 'Should we let branch staff approve small top-up loans (under RM 3,000) for existing customers with 12 months of clean repayment? → how to roll out',
  askedBy: 'Andrew Chong',
  department: { name: 'Credit & Collections', reviewBeforeActing: false },
  createdAt: new Date('2026-09-23T07:40:00Z'),
  completedAt: new Date('2026-09-23T07:41:30Z'),
  mode: 'council',
  cloudUsed: false,
  intent: 'decision',
  verdict,
  content: '',
  opinions: [
    ['contrarian', 'The Contrarian', 'I advise against branch approvals without controls.', 'Against, 4/5'],
    ['first_principles', 'First Principles Thinker', 'The goal is fast, safe decisions; rules can be automated.', 'Conditional, 3/5'],
    ['expansionist', 'The Expansionist', 'Branch approvals unlock top-up volume across the network.', 'For, 5/5'],
    ['customer_advocate', 'Customer Advocate', 'Customers wait days today; this fixes the worst moment 🙂.', 'For, 4/5'],
    ['executor', 'The Executor', 'Can pilot in 4 weeks with two branches.', 'Conditional, 4/5'],
    ['dept_expert', 'Department Expert', 'Proceed only with written criteria and sampling.', 'Conditional, 3/5'],
  ].map(([key, name, pos, st]) => ({ key, name, content: opinion(pos, st), stance: parseStance(opinion(pos, st)) })),
  reviews: [
    { reviewerKey: 'contrarian', reviewerName: 'The Contrarian', scores: { expansionist: { score: 2, flaw: 'Ignores fraud.' }, executor: { score: 4, flaw: 'Thin on cost.' } } },
    { reviewerKey: 'executor', reviewerName: 'The Executor', scores: { contrarian: { score: 3, flaw: 'No alternative.' }, expansionist: { score: 3, flaw: 'Unsized upside.' } } },
  ],
  citations: [{ id: 'S1', title: 'Credit Policy 2026', section: '4. Approval limits' }],
};

describe('parseStance', () => {
  it('reads the declared stance and conviction', () => {
    expect(parseStance(opinion('x', 'Conditional, 4/5'))).toMatchObject({ value: 'conditional', strength: 4, position: 'x' });
    expect(parseStance(opinion('x', 'Against (5/5)'))).toMatchObject({ value: 'against', strength: 5 });
    expect(parseStance('**Position:** I advise against this plan.')).toMatchObject({ value: 'against', strength: null });
    expect(parseStance('No structure at all')).toMatchObject({ value: 'unclear' });
  });
});

describe('planWeeks', () => {
  it('uses numeric weeks, and derives them from text for older verdicts', () => {
    expect(planWeeks(verdict).map((w) => [w.start, w.duration])).toEqual([[1, 2], [3, 1], [4, 8], [12, 1]]);
    const old = {
      ...verdict,
      action_plan: [
        { step: 'a', owner_role: 'x', timeline: 'Week 2' },
        { step: 'b', owner_role: 'x', timeline: 'Within 30 days' },
        { step: 'c', owner_role: 'x', timeline: 'Ongoing' },
      ],
    } as unknown as Verdict;
    for (const w of planWeeks(old)) {
      expect(w.start).toBeGreaterThanOrEqual(1);
      expect(w.duration).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('renderReport', () => {
  it('renders a council report with analytics pages', async () => {
    const pdf = await renderReport(data);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const pages = (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
    expect(pages).toBeGreaterThanOrEqual(4);
    if (process.env.REPORT_OUT) fs.writeFileSync(process.env.REPORT_OUT, pdf);
  });

  it('renders quick answers and verdicts that failed validation', async () => {
    const quick = await renderReport({ ...data, mode: 'quick', verdict: null, opinions: [], reviews: [], content: '## Answer\n\n- one\n- **two**' });
    expect(quick.subarray(0, 5).toString()).toBe('%PDF-');
    const raw = await renderReport({ ...data, verdict: null, content: 'Plain text verdict.' });
    expect(raw.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('handles verdicts generated before risk ratings existed', async () => {
    const old = { ...verdict, risks: verdict.risks.map(({ risk, mitigation }) => ({ risk, mitigation })) } as unknown as Verdict;
    const pdf = await renderReport({ ...data, verdict: old });
    expect(pdf.length).toBeGreaterThan(5000);
  });
});

describe('success measures', () => {
  it('words a target with or without a known baseline, and adds its check date to the check-ins', async () => {
    const { checkInDays, measureLine, verdictToMarkdown } = await import('../src/council/format.js');
    expect(measureLine({ measure: 'Roll rate', baseline: '22%', target: 'below 15%', check_after_days: 60 })).toBe('Roll rate: from 22% to below 15% (check after 60 days)');
    expect(measureLine({ measure: 'Default rate', baseline: '[need: current value]', target: 'below 3%', check_after_days: 90 })).toBe(
      'Default rate: to below 3% (check after 90 days) [need: current value]',
    );
    expect(checkInDays({ success_measures: [] })).toEqual([30, 60]);
    expect(checkInDays({ success_measures: [{ measure: 'a', baseline: '', target: 'b', check_after_days: 90 }, { measure: 'c', baseline: '', target: 'd', check_after_days: 30 }] })).toEqual([30, 60, 90]);
    expect(verdictToMarkdown(verdict)).toContain('## How we will know it worked\n- Top-up approval rate: from 18% to at least 25% (check after 60 days)');
  });
});
