import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import { createRedis } from './redis.js';

type Listener = (payload: string) => void;

/** One Redis subscriber connection shared by every open SSE stream in this process. */
class PubSubHub {
  private sub: Redis | null = null;
  private listeners = new Map<string, Set<Listener>>();

  private connection() {
    if (!this.sub) {
      this.sub = createRedis();
      this.sub.on('message', (channel: string, payload: string) => {
        for (const l of this.listeners.get(channel) ?? []) l(payload);
      });
    }
    return this.sub;
  }

  async subscribe(channel: string, listener: Listener) {
    let set = this.listeners.get(channel);
    if (!set) {
      set = new Set();
      this.listeners.set(channel, set);
      await this.connection().subscribe(channel);
    }
    set.add(listener);
    return async () => {
      set!.delete(listener);
      if (set!.size === 0) {
        this.listeners.delete(channel);
        await this.connection().unsubscribe(channel);
      }
    };
  }
}

export const hub = new PubSubHub();

export interface SseStream {
  send(event: string, data: unknown): void;
  close(): void;
  onClose(fn: () => void): void;
}

export function openSse(req: FastifyRequest, reply: FastifyReply): SseStream {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  const closers: Array<() => void> = [];
  let closed = false;
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    for (const fn of closers) fn();
  };
  req.raw.on('close', cleanup);
  return {
    send(event, data) {
      if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    close() {
      cleanup();
      res.end();
    },
    onClose(fn) {
      closers.push(fn);
    },
  };
}
