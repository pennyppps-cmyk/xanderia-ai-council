import type { Redis } from 'ioredis';

export const jobChannel = (messageId: string) => `job:${messageId}`;
export const userChannel = (userId: string) => `user:${userId}`;
const partialKey = (messageId: string, part: string) => `job:${messageId}:partial:${part}`;
const partsSetKey = (messageId: string) => `job:${messageId}:parts`;
const PARTIAL_TTL_S = 3600;

export type JobEvent =
  | { type: 'status'; status: 'queued' | 'running' | 'done' | 'error'; stage?: string; position?: number }
  | { type: 'router'; router: unknown; mode: 'quick' | 'council' }
  | { type: 'part_start'; part: string; stage: number; persona: string; label?: string }
  | { type: 'token'; part: string; offset: number; text: string }
  | { type: 'part_done'; part: string; content: string; data?: unknown; error?: string }
  | { type: 'citations'; citations: unknown[] }
  | { type: 'verdict'; verdict: unknown; raw?: string }
  | { type: 'clarify'; clarify: { questions: string[]; assumptions: string[] }; content: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

export interface TokenStream {
  push(text: string): void;
  /** Resolves once everything pushed so far is persisted and published. */
  flush(): Promise<void>;
}

export type Publisher = ReturnType<typeof createPublisher>;

export function createPublisher(redis: Redis, flushMs = 60) {
  async function emit(messageId: string, event: JobEvent) {
    await redis.publish(jobChannel(messageId), JSON.stringify(event));
  }

  /**
   * Batches tokens for one part. Each batch is APPENDed to a Redis key (so a
   * client that connects mid-stream can fetch the text so far) and published
   * with its byte offset, letting the client de-duplicate the overlap.
   */
  function tokenStream(messageId: string, part: string): TokenStream {
    let buffer = '';
    let timer: NodeJS.Timeout | null = null;
    let chain: Promise<void> = Promise.resolve();
    let registered = false;
    // JS string length sent so far (Redis APPEND returns bytes, which differ for non-ASCII).
    let sent = 0;

    const send = () => {
      timer = null;
      if (!buffer) return chain;
      const text = buffer;
      const offset = sent;
      buffer = '';
      sent += text.length;
      chain = chain.then(async () => {
        const key = partialKey(messageId, part);
        if (!registered) {
          registered = true;
          await redis.sadd(partsSetKey(messageId), part);
          await redis.expire(partsSetKey(messageId), PARTIAL_TTL_S);
        }
        await redis.append(key, text);
        await redis.expire(key, PARTIAL_TTL_S);
        await emit(messageId, { type: 'token', part, offset, text });
      });
      return chain;
    };

    return {
      push(text) {
        buffer += text;
        if (!timer) timer = setTimeout(send, flushMs);
      },
      flush() {
        if (timer) clearTimeout(timer);
        return send();
      },
    };
  }

  async function partials(messageId: string): Promise<Record<string, string>> {
    const parts = await redis.smembers(partsSetKey(messageId));
    const out: Record<string, string> = {};
    for (const part of parts) {
      const v = await redis.get(partialKey(messageId, part));
      if (v) out[part] = v;
    }
    return out;
  }

  async function clearPartials(messageId: string) {
    const parts = await redis.smembers(partsSetKey(messageId));
    const keys = parts.map((p) => partialKey(messageId, p));
    if (keys.length) await redis.del(...keys);
    await redis.del(partsSetKey(messageId));
  }

  async function notifyUser(userId: string, payload: Record<string, unknown>) {
    await redis.publish(userChannel(userId), JSON.stringify(payload));
  }

  return { emit, tokenStream, partials, clearPartials, notifyUser };
}
