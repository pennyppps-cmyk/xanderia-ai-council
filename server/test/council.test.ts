import { describe, expect, it } from 'vitest';
import { ADVISOR_REMINDER, CHAIRMAN_REMINDER, condenseForChairman, runCouncil, type Opinion } from '../src/council/council.js';
import { routeMessage } from '../src/council/router.js';
import { stressTestRequested } from '../src/council/triggers.js';
import type { ChatRequest } from '../src/llm/types.js';
import { FakeProvider, makeGateway, roleConfig } from './helpers.js';

const ADVISORS = [
  { key: 'contrarian', name: 'The Contrarian' },
  { key: 'first_principles', name: 'First Principles Thinker' },
  { key: 'executor', name: 'The Executor' },
];

const VERDICT = {
  verdict: 'Pilot the new reminder cadence in one branch.',
  why: 'Balances recovery upside against complaint risk.',
  conflicts: [
    {
      between: 'Contrarian vs Executor',
      position_a: 'Risk of harassment complaints',
      position_b: 'Can ship in 2 weeks',
      decision: 'Pilot first',
      because: 'Complaint risk is unquantified',
    },
  ],
  action_plan: [{ step: 'Draft scripts', owner_role: 'Collections Manager', timeline: 'Week 1', start_week: 1, duration_weeks: 1 }],
  risks: [{ risk: 'Complaints', likelihood: 'medium', impact: 'high', mitigation: 'Cap contact frequency' }],
  open_questions: ['What is the current roll rate?'],
  confidence: { level: 'medium', what_would_change: 'Pilot complaint data' },
};

const system = (req: ChatRequest) => req.messages[0].content;
const user = (req: ChatRequest) => req.messages.at(-1)!.content;
/** Advisors carry their role at the end of the user turn, not in the system prompt. */
const whole = (req: ChatRequest) => req.messages.map((m) => m.content).join('\n');

function scriptedProvider(overrides: { chairman?: () => string } = {}) {
  return new FakeProvider('local', false, (req) => {
    const s = system(req);
    if (s.includes('persona:chairman')) return overrides.chairman?.() ?? JSON.stringify(VERDICT);
    if (s.includes('task:peer_review')) {
      const labels = [...user(req).matchAll(/<advisor name="Advisor ([A-Z])">/g)].map((m) => m[1]);
      return JSON.stringify({
        reviews: labels.map((l) => ({ advisor: `Advisor ${l}`, biggest_flaw: `flaw in ${l}`, score: 3 })),
        strongest: `Advisor ${labels[0]}`,
        all_missed: 'Nobody costed the staff training.',
      });
    }
    const persona = /persona:(\w+)/.exec(whole(req))?.[1];
    return `**Position:** opinion from ${persona}`;
  });
}

const assemble = async (spec: { persona?: string; department?: string; task?: string }) =>
  [spec.persona && `persona:${spec.persona}`, spec.department && `department:${spec.department}`, spec.task && `task:${spec.task}`]
    .filter(Boolean)
    .join('\n');

function hooks() {
  const log: string[] = [];
  return {
    log,
    hooks: {
      onStage: (s: string) => void log.push(`stage:${s}`),
      onPartStart: (part: string) => void log.push(`start:${part}`),
      onToken: () => {},
      onPartDone: (part: string, _st: number, _a: unknown, p: { error?: string }) =>
        void log.push(`done:${part}${p.error ? ':error' : ''}`),
    },
  };
}

const baseInput = {
  question: 'Should we call 30-DPD customers daily instead of weekly?',
  history: [],
  department: { slug: 'credit-collections', name: 'Credit & Collections' },
  knowledge: [],
  language: 'en' as const,
  sensitivity: 'low' as const,
  advisors: ADVISORS,
};

describe('runCouncil', () => {
  it('runs stage 1 → stage 3 and returns a validated verdict (peer review off)', async () => {
    const provider = scriptedProvider();
    const { gateway, audit } = makeGateway({ providers: [provider], roles: { '*': 'local' } });
    const { log, hooks: h } = hooks();
    const res = await runCouncil(
      { gateway, assemble, getRoleConfig: async (r) => roleConfig(r, 'local') },
      { ...baseInput, peerReview: false },
      h,
    );
    // A verdict without the newer sections still validates; they default to empty.
    expect(res.verdict).toEqual({ ...VERDICT, agreements: [], blind_spots: [], first_step: '', success_measures: [] });
    expect(res.opinions.map((o) => o.content)).toEqual(ADVISORS.map((a) => `**Position:** opinion from ${a.key}`));
    expect(res.reviews).toEqual([]);
    expect(log).toContain('stage:stage1');
    expect(log).not.toContain('stage:stage2');
    expect(log).toContain('stage:stage3');
    // 3 advisors + chairman, all audited
    expect(audit.map((a) => a.detail.role)).toEqual(
      expect.arrayContaining(['advisor:contrarian', 'advisor:first_principles', 'advisor:executor', 'chairman']),
    );
    // Chairman sees every opinion, named by persona
    const chair = provider.requests.find((r) => system(r).includes('persona:chairman'))!;
    for (const a of ADVISORS) expect(user(chair)).toContain(`<advisor name="${a.name}">`);
    expect(chair.jsonSchema).toBeDefined();
  });

  it('anonymises stage 2: reviewers see labels, never persona names, and not their own answer', async () => {
    const provider = scriptedProvider();
    const { gateway } = makeGateway({ providers: [provider], roles: { '*': 'local' } });
    const res = await runCouncil(
      {
        gateway,
        assemble,
        getRoleConfig: async (r) => roleConfig(r, 'local'),
        shuffle: (x) => [...x].reverse(),
      },
      { ...baseInput, peerReview: true },
      hooks().hooks,
    );
    const reviewRequests = provider.requests.filter((r) => system(r).includes('task:peer_review'));
    expect(reviewRequests).toHaveLength(3);
    for (const r of reviewRequests) {
      const text = user(r);
      for (const a of ADVISORS) expect(text).not.toContain(a.name);
      expect([...text.matchAll(/<advisor name="Advisor/g)]).toHaveLength(2);
    }
    // Scores are mapped back to the right advisor key.
    expect(res.reviews).toHaveLength(3);
    for (const review of res.reviews) {
      expect(Object.keys(review.scores)).not.toContain(review.reviewer.key);
      expect(Object.keys(review.scores)).toHaveLength(2);
    }
    const chair = provider.requests.find((r) => system(r).includes('persona:chairman'))!;
    expect(user(chair)).toContain('average peer score 3.0/5');
    // Votes for the strongest answer and the collective blind spot reach the Chairman.
    expect(user(chair)).toMatch(/Voted strongest answer: .+\(\d\)/);
    expect(user(chair)).toContain('ALL answers missed (use for blind_spots):\n- Nobody costed the staff training.');
  });

  it('falls back to raw text when the chairman output never validates', async () => {
    const provider = scriptedProvider({ chairman: () => 'Plain text verdict: pilot first.' });
    const { gateway } = makeGateway({ providers: [provider], roles: { '*': 'local' } });
    const res = await runCouncil(
      { gateway, assemble, getRoleConfig: async (r) => roleConfig(r, 'local') },
      { ...baseInput, peerReview: false },
      hooks().hooks,
    );
    expect(res.verdict).toBeNull();
    expect(res.verdictRaw).toBe('Plain text verdict: pilot first.');
    // initial attempt + one retry
    expect(provider.requests.filter((r) => system(r).includes('persona:chairman'))).toHaveLength(2);
  });

  it('asks the chairman for Bahasa Malaysia output for BM users', async () => {
    const provider = scriptedProvider();
    const { gateway } = makeGateway({ providers: [provider], roles: { '*': 'local' } });
    await runCouncil(
      { gateway, assemble, getRoleConfig: async (r) => roleConfig(r, 'local') },
      { ...baseInput, language: 'ms', peerReview: false },
      hooks().hooks,
    );
    const chair = provider.requests.find((r) => system(r).includes('persona:chairman'))!;
    expect(system(chair)).toContain('Bahasa Malaysia');
    // Advisors still reason in English
    const advisor = provider.requests.find((r) => whole(r).includes('persona:contrarian'))!;
    expect(system(advisor)).toContain('task:council_advisor');
  });

  it('survives one failed advisor but fails with fewer than two opinions', async () => {
    const flaky = new FakeProvider('local', false, (req) => {
      if (whole(req).includes('persona:contrarian')) throw new Error('timeout');
      if (system(req).includes('persona:chairman')) return JSON.stringify(VERDICT);
      return 'opinion';
    });
    const { gateway } = makeGateway({ providers: [flaky], roles: { '*': 'local' } });
    const { log, hooks: h } = hooks();
    const res = await runCouncil(
      { gateway, assemble, getRoleConfig: async (r) => roleConfig(r, 'local') },
      { ...baseInput, peerReview: false },
      h,
    );
    expect(res.verdict).not.toBeNull();
    expect(log).toContain('done:s1:contrarian:error');

    const dead = new FakeProvider('local', false, () => {
      throw new Error('ollama down');
    });
    const g2 = makeGateway({ providers: [dead], roles: { '*': 'local' } });
    await expect(
      runCouncil(
        { gateway: g2.gateway, assemble, getRoleConfig: async (r) => roleConfig(r, 'local') },
        { ...baseInput, peerReview: false },
        hooks().hooks,
      ),
    ).rejects.toThrow(/at least 2 advisor opinions/);
  });

  it('gives knowledge only to the department expert', async () => {
    const provider = scriptedProvider();
    const { gateway } = makeGateway({ providers: [provider], roles: { '*': 'local' } });
    await runCouncil(
      { gateway, assemble, getRoleConfig: async (r) => roleConfig(r, 'local') },
      {
        ...baseInput,
        advisors: [...ADVISORS, { key: 'dept_expert', name: 'Department Expert' }],
        knowledge: [{ documentId: 'd1', title: 'Collections SOP', section: '2. Cadence', content: 'Call on day 3', distance: 0.2 }],
        peerReview: false,
      },
      hooks().hooks,
    );
    const expert = provider.requests.find((r) => whole(r).includes('persona:dept_expert'))!;
    expect(user(expert)).toContain('department:credit-collections');
    expect(user(expert)).toContain('<document id="S1" title="Collections SOP" section="2. Cadence">');
    const contrarian = provider.requests.find((r) => whole(r).includes('persona:contrarian'))!;
    expect(user(contrarian)).not.toContain('<document');
  });

  it('puts what advisors share first and each role last, so a long document is read once per slot', async () => {
    const provider = scriptedProvider();
    const { gateway } = makeGateway({ providers: [provider], roles: { '*': 'local' } });
    await runCouncil(
      { gateway, assemble, getRoleConfig: async (r) => roleConfig(r, 'local') },
      { ...baseInput, attachments: [{ name: 'report.pdf', text: 'Finding 1: TLS verification disabled. '.repeat(50) }], peerReview: false },
      hooks().hooks,
    );
    const advisors = provider.requests.filter((r) => whole(r).includes('task:council_advisor'));
    expect(advisors).toHaveLength(3);
    // Same system prompt, and the user turn is identical up to the role.
    expect(new Set(advisors.map(system)).size).toBe(1);
    const shared = advisors.map((r) => user(r).split('Your role on the council')[0]);
    expect(new Set(shared).size).toBe(1);
    expect(shared[0]).toContain('<attachment name="report.pdf">');
    for (const r of advisors) expect(user(r)).toMatch(/Your role on the council[^]*persona:\w+\n\n/);
    // The specificity rules are repeated last, where Qwen follows them best.
    for (const r of advisors) expect(user(r).endsWith(ADVISOR_REMINDER)).toBe(true);
    const chair = provider.requests.find((r) => whole(r).includes('task:chairman'))!;
    expect(user(chair).endsWith(CHAIRMAN_REMINDER)).toBe(true);
  });
});

describe('condenseForChairman', () => {
  it('leaves opinions alone when they fit and trims evenly when they do not', () => {
    const ops = [1, 2, 3].map((i) => ({ content: 'x'.repeat(10_000), advisor: { key: `a${i}`, name: '' }, label: 'A' })) as Opinion[];
    expect(condenseForChairman(ops, '', 100_000).condensed).toBe(false);
    const { texts, condensed } = condenseForChairman(ops, '', 3000);
    expect(condensed).toBe(true);
    for (const t of texts) expect(t.length).toBeLessThan(4000);
  });
});

describe('routeMessage', () => {
  const departments = [
    { slug: 'hr', name: 'HR' },
    { slug: 'finance', name: 'Finance' },
  ];

  it('returns the model classification, but regex PII detection can only raise sensitivity', async () => {
    const p = new FakeProvider('local', false, () =>
      JSON.stringify({
        department: 'finance',
        intent: 'decision',
        contains_pii: false,
        sensitivity: 'low',
        suggested_mode: 'council',
        language: 'en',
        reason: 'budget decision',
      }),
    );
    const { gateway } = makeGateway({ providers: [p], roles: { '*': 'local' } });
    const r = await routeMessage(
      { gateway, assemble },
      { question: 'Approve budget for customer 900101-14-5678?', departments, defaultDepartment: 'hr' },
    );
    expect(r).toMatchObject({ department: 'finance', suggested_mode: 'council', contains_pii: true, sensitivity: 'high', source: 'model' });
    expect(p.requests[0].temperature).toBeDefined();
  });

  it('falls back to heuristics when the model output is unusable', async () => {
    const p = new FakeProvider('local', false, () => 'not json');
    const { gateway } = makeGateway({ providers: [p], roles: { '*': 'local' } });
    const r = await routeMessage(
      { gateway, assemble },
      { question: 'Bagaimana kita patut rancang pengambilan staf untuk tahun depan?', departments, defaultDepartment: 'hr' },
    );
    expect(r).toMatchObject({ source: 'fallback', department: 'hr', language: 'ms', suggested_mode: 'council' });
  });
});

describe('clarifying questions', () => {
  it('asks only when the clarifier says information is missing', async () => {
    const { checkClarity } = await import('../src/council/clarify.js');
    const asks = new FakeProvider('local', false, () =>
      JSON.stringify({ needs_clarification: true, questions: ['What is the budget?', ' ', 'Which branches?', 'x', 'y'], assumptions_if_skipped: ['Budget under RM 50k'] }),
    );
    const g1 = makeGateway({ providers: [asks], roles: { '*': 'local' } });
    const r = await checkClarity({ gateway: g1.gateway, assemble }, { question: 'Plan a rollout', departmentName: 'Ops', sensitivity: 'low' });
    expect(r).toEqual({ questions: ['What is the budget?', 'Which branches?', 'x'], assumptions: ['Budget under RM 50k'] });
    expect(asks.requests[0].jsonSchema).toBeDefined();

    const clear = new FakeProvider('local', false, () => JSON.stringify({ needs_clarification: false, questions: [], assumptions_if_skipped: [] }));
    const g2 = makeGateway({ providers: [clear], roles: { '*': 'local' } });
    expect(await checkClarity({ gateway: g2.gateway, assemble }, { question: 'x', departmentName: 'Ops', sensitivity: 'low' })).toBeNull();

    // A failing check never blocks the council.
    const broken = new FakeProvider('local', false, () => { throw new Error('down'); });
    const g3 = makeGateway({ providers: [broken], roles: { '*': 'local' } });
    expect(await checkClarity({ gateway: g3.gateway, assemble }, { question: 'x', departmentName: 'Ops', sensitivity: 'low' })).toBeNull();
  });

  it('merges the answers (or the skip + assumptions) into the question the council considers', async () => {
    const { composeClarifiedQuestion } = await import('../src/council/clarify.js');
    const c = { questions: ['Budget?', 'Which branches?'], assumptions: ['Under RM 50k'] };
    const answered = composeClarifiedQuestion('Plan a rollout', c, 'RM 30k, Klang and Shah Alam', false);
    expect(answered).toContain('Plan a rollout');
    expect(answered).toContain('1. Budget?');
    expect(answered).toContain('RM 30k, Klang and Shah Alam');
    const skipped = composeClarifiedQuestion('Plan a rollout', c, 'skip', true);
    expect(skipped).toContain('Under RM 50k');
    expect(skipped).not.toContain('The asker answered');
  });
});

describe('red-flag detection', () => {
  const departments = [{ slug: 'credit-collections', name: 'Credit & Collections' }];
  it('passes the router red flag through, and defaults to none', async () => {
    const flagged = new FakeProvider('local', false, () =>
      JSON.stringify({
        department: 'credit-collections', intent: 'plan', contains_pii: false, sensitivity: 'low', suggested_mode: 'quick',
        language: 'en', red_flag: 'harassment', red_flag_reason: 'Threatens to tell employer', reason: 'x',
      }),
    );
    const g1 = makeGateway({ providers: [flagged], roles: { '*': 'local' } });
    const r1 = await routeMessage({ gateway: g1.gateway, assemble }, { question: 'Tell their boss', departments, defaultDepartment: 'credit-collections' });
    expect(r1).toMatchObject({ red_flag: 'harassment', red_flag_reason: 'Threatens to tell employer' });

    const plain = new FakeProvider('local', false, () =>
      JSON.stringify({ department: 'credit-collections', intent: 'question', contains_pii: false, sensitivity: 'low', suggested_mode: 'quick', language: 'en', reason: 'x' }),
    );
    const g2 = makeGateway({ providers: [plain], roles: { '*': 'local' } });
    const r2 = await routeMessage({ gateway: g2.gateway, assemble }, { question: 'Normal', departments, defaultDepartment: 'credit-collections' });
    expect(r2.red_flag).toBe('none');
  });
});

describe('stress-test phrases', () => {
  it('ask for the full council in English and Bahasa Malaysia, and ignore ordinary questions', () => {
    for (const q of ['Council this: move collections calls to 8am?', 'Can you stress-test this plan', 'war room this', 'pressure test our pricing', 'Tolong uji tekanan cadangan ini', 'bawa ke majlis: kempen baharu']) {
      expect(stressTestRequested(q)).toBe(true);
    }
    for (const q of ['What is our refund policy?', 'How do I reset my password?', 'Test the new dialler script']) {
      expect(stressTestRequested(q)).toBe(false);
    }
  });
});
