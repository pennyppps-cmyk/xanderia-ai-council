import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { VerdictSchema } from '../src/llm/schemas.js';
import { callStructured, extractJson, toJsonSchema } from '../src/llm/structured.js';
import { FakeProvider, makeGateway } from './helpers.js';

const Schema = z.object({ answer: z.string(), score: z.number().int().min(1).max(5) });

describe('callStructured', () => {
  it('passes the JSON schema to the provider and returns validated data', async () => {
    const p = new FakeProvider('local', false, () => '{"answer":"yes","score":4}');
    const { gateway } = makeGateway({ providers: [p], roles: { '*': 'local' } });
    const res = await callStructured(gateway, 'router', [{ role: 'user', content: 'q' }], Schema, { priority: 1 });
    expect(res).toMatchObject({ ok: true, data: { answer: 'yes', score: 4 }, attempts: 1 });
    expect(p.requests[0].jsonSchema).toMatchObject({ type: 'object', required: ['answer', 'score'] });
  });

  it('retries once with the validation error appended', async () => {
    const replies = ['{"answer":"yes","score":9}', '{"answer":"yes","score":5}'];
    const p = new FakeProvider('local', false, () => replies.shift()!);
    const { gateway } = makeGateway({ providers: [p], roles: { '*': 'local' } });
    const res = await callStructured(gateway, 'chairman', [{ role: 'user', content: 'q' }], Schema, { priority: 1 });
    expect(res).toMatchObject({ ok: true, attempts: 2, data: { score: 5 } });
    const retry = p.requests[1].messages;
    expect(retry.at(-2)).toMatchObject({ role: 'assistant', content: '{"answer":"yes","score":9}' });
    expect(retry.at(-1)!.content).toMatch(/failed validation: score/);
  });

  it('falls back (ok:false with raw text) after two failures', async () => {
    const p = new FakeProvider('local', false, () => 'I think the answer is yes.');
    const { gateway } = makeGateway({ providers: [p], roles: { '*': 'local' } });
    const res = await callStructured(gateway, 'chairman', [{ role: 'user', content: 'q' }], Schema, { priority: 1 });
    expect(res.ok).toBe(false);
    expect(res.raw).toBe('I think the answer is yes.');
    expect(p.requests).toHaveLength(2);
  });

  it('extracts JSON wrapped in code fences or chatter', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! {"a":2} hope that helps')).toEqual({ a: 2 });
  });

  it('produces an Ollama-compatible verdict schema with the conflicts field required', () => {
    const js = toJsonSchema(VerdictSchema) as any;
    expect(js.$schema).toBeUndefined();
    expect(js.required).toEqual(
      expect.arrayContaining(['verdict', 'why', 'conflicts', 'action_plan', 'risks', 'open_questions', 'confidence']),
    );
    expect(js.properties.conflicts.items.required).toEqual(
      expect.arrayContaining(['between', 'decision', 'because']),
    );
  });
});
