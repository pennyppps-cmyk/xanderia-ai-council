import { describe, expect, it } from 'vitest';
import { cleanRewrite, condenseQuestion, transcript } from '../src/council/condense.js';
import { runCouncil } from '../src/council/council.js';
import type { ChatMessage, ChatRequest } from '../src/llm/types.js';
import { FakeProvider, makeGateway, roleConfig } from './helpers.js';

const assemble = async (spec: { persona?: string; task: string }) => [spec.persona && `persona:${spec.persona}`, `task:${spec.task}`].filter(Boolean).join('\n');

const HISTORY: ChatMessage[] = [
  { role: 'user', content: 'i want a plan to implement this system to a server' },
  { role: 'assistant', content: 'Here is a plan to implement the leave and gift/hospitality systems on servers: ...' },
];

describe('follow-up rewriting', () => {
  it('rewrites a correction into a standalone question, using the conversation', async () => {
    const provider = new FakeProvider('local', false, (req) => {
      expect(req.messages[0].content).toContain('task:condense');
      expect(req.messages[1].content).toContain('User: i want a plan to implement this system to a server');
      return 'Standalone question: "Plan how to deploy the Xanderia AI Council on our office server."';
    });
    const { gateway, audit } = makeGateway({ providers: [provider], roles: { '*': 'local' } });
    const out = await condenseQuestion({ gateway, assemble }, { question: 'i meant xanderia ai council', history: HISTORY });
    expect(out).toEqual({ question: 'Plan how to deploy the Xanderia AI Council on our office server.', rewritten: true });
    // Audited as its own purpose, and kept on-premises like the router.
    expect(audit.at(-1)!.detail).toMatchObject({ purpose: 'condense' });
  });

  it('does nothing without history, for long messages, or when the model repeats the question', async () => {
    const provider = new FakeProvider('local', false, (req) => req.messages[1].content.match(/<message>\n([\s\S]*)\n<\/message>/)![1]);
    const { gateway } = makeGateway({ providers: [provider], roles: { '*': 'local' } });
    expect(await condenseQuestion({ gateway, assemble }, { question: 'What is a roll rate?', history: [] })).toEqual({ question: 'What is a roll rate?', rewritten: false });
    const long = 'x'.repeat(900);
    expect((await condenseQuestion({ gateway, assemble }, { question: long, history: HISTORY })).rewritten).toBe(false);
    expect(provider.requests).toHaveLength(0);
    expect(await condenseQuestion({ gateway, assemble }, { question: 'What is a roll rate?', history: HISTORY })).toEqual({ question: 'What is a roll rate?', rewritten: false });
  });

  it('falls back to the original message when the model fails or rambles', async () => {
    const failing = new FakeProvider('local', false, () => {
      throw new Error('model down');
    });
    const { gateway } = makeGateway({ providers: [failing], roles: { '*': 'local' } });
    expect(await condenseQuestion({ gateway, assemble }, { question: 'and for 90+?', history: HISTORY })).toEqual({ question: 'and for 90+?', rewritten: false });
    expect(cleanRewrite('y'.repeat(5000), 'and for 90+?')).toBe('and for 90+?');
    expect(cleanRewrite('   ', 'and for 90+?')).toBe('and for 90+?');
    // Numbers that appear nowhere in the conversation mean the model made something up.
    expect(cleanRewrite('What about implementing the Council for over 90 days?', 'i meant xanderia ai council', 'User: plan to deploy this system')).toBe(
      'i meant xanderia ai council',
    );
    expect(cleanRewrite('What is the roll rate for 61-90 DPD?', 'and 61-90?', 'User: roll rate for 31-60 DPD')).toBe('What is the roll rate for 61-90 DPD?');
  });

  it('builds a trimmed transcript of the last turns', () => {
    const long: ChatMessage[] = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i} ${'z'.repeat(800)}` }));
    const t = transcript(long, 2, 50);
    expect(t.split('\n\n')).toHaveLength(4);
    expect(t.startsWith('User: m6')).toBe(true);
    expect(t).toContain(' …');
  });
});

describe('Chairman context', () => {
  it('gives the Chairman the recent conversation', async () => {
    const provider = new FakeProvider('local', false, (req: ChatRequest) =>
      req.messages[0].content.includes('persona:chairman')
        ? JSON.stringify({
            verdict: 'Deploy on aixan with Ollama on the GPU VM.',
            why: 'x',
            conflicts: [],
            action_plan: [{ step: 's', owner_role: 'IT', timeline: 'Week 1', start_week: 1, duration_weeks: 1 }],
            risks: [],
            open_questions: [],
            confidence: { level: 'medium', what_would_change: 'x' },
          })
        : '**Position:** ok',
    );
    const { gateway } = makeGateway({ providers: [provider], roles: { '*': 'local' } });
    const noop = { onStage: () => {}, onPartStart: () => {}, onToken: () => {}, onPartDone: () => {} };
    await runCouncil(
      { gateway, assemble, getRoleConfig: async (r) => roleConfig(r, 'local') },
      {
        question: 'Plan how to deploy the Xanderia AI Council on our office server.',
        history: HISTORY,
        department: { slug: 'technology', name: 'Technology' },
        knowledge: [],
        language: 'en',
        sensitivity: 'low',
        advisors: [{ key: 'executor', name: 'The Executor' }, { key: 'contrarian', name: 'The Contrarian' }],
        peerReview: false,
      },
      noop,
    );
    const chair = provider.requests.find((r) => r.messages[0].content.includes('persona:chairman'))!;
    expect(chair.messages.at(-1)!.content).toContain('Conversation so far (context only)');
    expect(chair.messages.at(-1)!.content).toContain('User: i want a plan to implement this system to a server');
  });
});
