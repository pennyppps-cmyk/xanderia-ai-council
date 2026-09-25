import { describe, expect, it } from 'vitest';
import { cleanRewrite } from '../src/council/condense.js';
import { confirmedFacts, factsBlock, parseOpenAnswer, questionForOpenAnswer } from '../src/council/facts.js';

const Q = 'What specific delinquency thresholds should be used for classifying loans as non-performing (30/90/180 days past due)?';

describe('answers the asker already gave', () => {
  it('recognises an answer to an open question, in English and Malay', () => {
    expect(parseOpenAnswer(`Answer to the council's open question "${Q}": 180 days`)).toEqual({ question: Q, answer: '180 days' });
    expect(parseOpenAnswer('Jawapan kepada soalan terbuka majlis "Berapa hari?": 180 hari')).toEqual({ question: 'Berapa hari?', answer: '180 hari' });
    expect(parseOpenAnswer(`Answer to the council's open question "${Q}":`)).toBeNull(); // no answer typed
    expect(parseOpenAnswer('What is a roll rate?')).toBeNull();
  });

  it('collects clarifying answers and open-question answers as confirmed facts', () => {
    const facts = confirmedFacts([
      { role: 'user', content: 'make me a plan for calculating npl off my current loan database now' },
      {
        role: 'assistant',
        content: '…',
        options: {
          clarifiedFrom: 'x',
          effectiveQuestion:
            'make me a plan…\n\nThe council asked:\n1. What type of loans?\n2. How many loans?\n\nThe asker answered:\npersonal loans to civil servants; 17,825 loans worth 442,968,400',
        },
      },
      { role: 'user', content: `Answer to the council's open question "${Q}": 180 days` },
      { role: 'assistant', content: '…' },
      { role: 'user', content: 'Answer to the council\'s open question "How do we ensure accuracy?": i have an excel table' },
    ]);
    expect(facts).toHaveLength(3);
    expect(facts[0]).toContain('17,825 loans');
    expect(facts[1]).toBe(`${Q} → 180 days`);
    expect(facts[2]).toBe('How do we ensure accuracy? → i have an excel table');
    expect(factsBlock(facts)).toContain('do not ask about them again');
    expect(factsBlock([])).toBe('');
  });

  it('turns an open-question answer into an update of the plan, without stacking earlier updates', () => {
    const first = questionForOpenAnswer('Plan NPL calculation for 2022-2026', { question: Q, answer: '180 days' });
    expect(first).toContain('Plan NPL calculation for 2022-2026');
    expect(first).toContain(': 180 days');
    const second = questionForOpenAnswer(first, { question: 'How to ensure accuracy?', answer: 'Excel table' });
    expect(second.match(/The asker has now answered/g)).toHaveLength(1);
    expect(second).toContain('Excel table');
  });

  it('removes open questions the asker already answered, and keeps new ones', async () => {
    const { dropAnswered, answeredQuestions } = await import('../src/council/facts.js');
    const answered = answeredQuestions([
      { role: 'user', content: `Answer to the council's open question "${Q}": 180 days` },
      {
        role: 'assistant',
        content: '…',
        options: { clarifiedFrom: 'x', effectiveQuestion: 'q\n\nThe council asked:\n1. What specific type of loans are in your database?\n\nThe asker answered:\npersonal' },
      },
    ]);
    expect(answered).toEqual([Q, 'What specific type of loans are in your database?']);
    const open = [
      'What are the specific thresholds for classifying a loan as non-performing?', // same as Q, reworded
      'What delinquency thresholds should classify loans as non-performing (30/90/180 days)?', // same again
      'Who will own the monthly NPL report?', // new
    ];
    expect(dropAnswered(open, answered)).toEqual(['Who will own the monthly NPL report?']);
  });

  it('never lets a follow-up rewrite drop a number the asker typed', () => {
    expect(cleanRewrite('What delinquency thresholds should we use?', 'and use 180 days', 'User: thresholds 30/90/180')).toBe('and use 180 days');
    expect(cleanRewrite('Use a 180-day threshold for NPL.', 'and use 180 days', 'User: thresholds')).toBe('Use a 180-day threshold for NPL.');
  });
});
