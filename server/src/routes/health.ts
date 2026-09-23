import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { redis } from '../redis.js';

async function check<T>(fn: () => Promise<T>): Promise<{ ok: boolean; detail?: T; error?: string }> {
  try {
    return { ok: true, detail: await fn() };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export default async function healthRoutes(app: FastifyInstance) {
  // Liveness only — no dependencies, for Docker healthchecks.
  app.get('/api/health', { logLevel: 'silent' }, async () => ({ ok: true }));

  // Dependency status for admins, including whether the configured models are pulled.
  app.get('/api/admin/health', { preHandler: app.requireRole('admin') }, async () => {
    const [db, cache, ollama] = await Promise.all([
      check(() => query('SELECT 1').then(() => 'ok')),
      check(() => redis.ping()),
      check(async () => {
        const headers: Record<string, string> = {};
        if (config.OLLAMA_API_KEY) headers[config.OLLAMA_API_KEY_HEADER] = config.OLLAMA_API_KEY;
        const res = await fetch(`${config.OLLAMA_BASE_URL.replace(/\/+$/, '')}/api/tags`, {
          headers,
          signal: AbortSignal.timeout(4000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const tags: any = await res.json();
        const installed: string[] = tags.models.map((m: any) => m.name);
        const { rows } = await query(
          `SELECT DISTINCT r.model FROM model_roles r JOIN providers p ON p.id = r.provider_id WHERE p.kind = 'ollama'`,
        );
        const needed: string[] = rows.map((r) => r.model);
        const has = (m: string) => installed.some((i) => i === m || i === `${m}:latest`);
        return { url: config.OLLAMA_BASE_URL, installed, missing: needed.filter((m) => !has(m)) };
      }),
    ]);
    return { db, redis: cache, ollama };
  });
}
