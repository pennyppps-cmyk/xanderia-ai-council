import { z } from 'zod';
import type { CallContext, CallOutcome, LlmGateway } from './gateway.js';
import type { ChatMessage } from './types.js';

/** Zod → JSON schema for Ollama's `format` (draft-7 subset, no $schema key). */
export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema, { target: 'draft-7' }) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

/** Extract the JSON object from a model reply (tolerates code fences / chatter around it). */
export function extractJson(raw: string): unknown {
  const text = raw.replace(/```(?:json)?/gi, '').trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error('No JSON object found in model output');
  }
}

function validationMessage(err: unknown) {
  if (err instanceof z.ZodError) {
    return err.issues
      .slice(0, 8)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
  }
  return (err as Error).message;
}

export type StructuredResult<T> =
  | { ok: true; data: T; raw: string; attempts: number; outcome: CallOutcome }
  | { ok: false; raw: string; attempts: number; error: string; outcome?: CallOutcome };

/**
 * Call a role with a JSON schema. On parse/validation failure, retry once with
 * the validation error appended; if that also fails, return ok:false with the
 * raw text so the caller can fall back to plain-text display.
 */
export async function callStructured<T>(
  gateway: Pick<LlmGateway, 'call'>,
  role: string,
  messages: ChatMessage[],
  schema: z.ZodType<T>,
  ctx: CallContext,
): Promise<StructuredResult<T>> {
  const jsonSchema = toJsonSchema(schema);
  let convo = messages;
  let lastRaw = '';
  let lastError = '';
  let lastOutcome: CallOutcome | undefined;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const outcome = await gateway.call(role, convo, { ...ctx, jsonSchema });
    lastOutcome = outcome;
    lastRaw = outcome.content;
    try {
      const data = schema.parse(extractJson(outcome.content));
      return { ok: true, data, raw: outcome.content, attempts: attempt, outcome };
    } catch (err) {
      lastError = validationMessage(err);
      convo = [
        ...messages,
        { role: 'assistant', content: outcome.content },
        {
          role: 'user',
          content: `Your previous output failed validation: ${lastError}. Return ONLY one valid JSON object that matches the required schema, with every required field filled in.`,
        },
      ];
    }
  }
  return { ok: false, raw: lastRaw, attempts: 2, error: lastError, outcome: lastOutcome };
}
