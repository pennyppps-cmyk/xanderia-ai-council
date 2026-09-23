import { describe, expect, it } from 'vitest';
import { condenseForChairman, runCouncil, type Opinion } from '../src/council/council.js';
import { routeMessage } from '../src/council/router.js';
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
  action_plan: [{ step: 'Draft scripts', owner_role: 'Collections Manager', timeline: 'Week 1' }],
  risks: [{ risk: 'Complaints', mitigation: 'Cap contact frequency' }],
  open_questions: ['What is the current roll rate?'],
  confidence: { level: 'medium', what_would_change: 'Pilot complaint data' },
};

const system = (req: ChatRequest) => req.messages[0].content;
const user = (req: ChatRequest) => req.messages.at(-1)!.content;

function scriptedProvider(overrides: { chairman?: () => string } = {}) {
  return new FakeProvider('local', false, (req) => {
    const s = system(req);
    if (s.includes('persona:chairman')) return overrides.chairman?.() ?? JSON.stringify(VERDICT);
    if (s.includes('task:peer_review')) {
      const labels = [...user(req).matchAll(/<advisor name="Advisor ([A-Z])">/g)].map((m) => m[1]);
      return JSON.stringify({
        reviews: labels.map((l) => ({ advisor: `Advisor ${l}`, biggest_flaw: `flaw in ${l}`, score: 3 })),
        strongest: `Advisor ${labels[0]}`,
      });
    }
    const persona = /persona:(\w+)/.exec(s)?.[1];
    return `**Position:** opinion from ${persona}`;
  });
}

const assemble = async (spec: { persona?: string; department?: string; task: string }) =>
  [spec.persona && `persona:${spec.persona}`, spec.department && `department:${spec.department}`, `task:${spec.task}`]
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
    expect(res.verdict).toEqual(VERDICT);
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
    const advisor = provider.requests.find((r) => system(r).includes('persona:contrarian'))!;
    expect(system(advisor)).toContain('task:council_advisor');
  });

  it('survives one failed advisor but fails with fewer than two opinions', async () => {
    const flaky = new FakeProvider('local', false, (req) => {
      if (system(req).includes('persona:contrarian')) throw new Error('timeout');
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
    const expert = provider.requests.find((r) => system(r).includes('persona:dept_expert'))!;
    expect(system(expert)).toContain('department:credit-collections');
    expect(user(expert)).toContain('<document id="S1" title="Collections SOP" section="2. Cadence">');
    const contrarian = provider.requests.find((r) => system(r).includes('persona:contrarian'))!;
    expect(user(contrarian)).not.toContain('<document');
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
