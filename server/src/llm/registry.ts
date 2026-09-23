import { writeAudit } from '../audit.js';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { createGateway } from './gateway.js';
import { OllamaProvider } from './providers/ollama.js';
import { OpenAICompatibleProvider } from './providers/openaiCompatible.js';
import type { ChatProvider, ProviderRow, RoleConfig } from './types.js';

const TTL_MS = 10_000;
const roleCache = new Map<string, { at: number; value: RoleConfig }>();
const providerCache = new Map<string, { at: number; key: string; value: ChatProvider }>();

/** `${VAR}` in a providers.base_url is expanded from the environment at runtime. */
export function expandEnv(value: string) {
  return value.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? (config as any)[name] ?? '');
}

export function buildProvider(row: ProviderRow): ChatProvider {
  const apiKey = row.api_key_env ? process.env[row.api_key_env] || undefined : undefined;
  const baseUrl = expandEnv(row.base_url);
  switch (row.kind) {
    case 'ollama':
      return new OllamaProvider({
        id: row.id,
        baseUrl,
        apiKey,
        apiKeyHeader: config.OLLAMA_API_KEY_HEADER,
        maxParallel: row.max_parallel,
      });
    case 'openai_compatible':
      return new OpenAICompatibleProvider(row.id, baseUrl, apiKey, row.is_cloud, row.max_parallel);
    default:
      throw new Error(`Unknown provider kind: ${(row as ProviderRow).kind}`);
  }
}

export async function getRoleConfig(role: string): Promise<RoleConfig> {
  const hit = roleCache.get(role);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const { rows } = await query<RoleConfig>('SELECT * FROM model_roles WHERE role = $1', [role]);
  if (!rows[0]) throw new Error(`No model_roles row for role "${role}"`);
  roleCache.set(role, { at: Date.now(), value: rows[0] });
  return rows[0];
}

export async function getProvider(id: string): Promise<ChatProvider> {
  const hit = providerCache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const { rows } = await query<ProviderRow>('SELECT * FROM providers WHERE id = $1', [id]);
  const row = rows[0];
  if (!row) throw new Error(`Provider "${id}" not found`);
  if (!row.enabled) throw new Error(`Provider "${id}" is disabled`);
  const key = JSON.stringify(row);
  // Keep the same instance while the row is unchanged, so its gate keeps its queue.
  const value = hit && hit.key === key ? hit.value : buildProvider(row);
  providerCache.set(id, { at: Date.now(), key, value });
  return value;
}

export async function getLocalFallback() {
  const { rows } = await query(`SELECT value FROM settings WHERE key = 'local_fallback'`);
  const v = rows[0]?.value ?? { provider_id: 'ollama', model: config.DEFAULT_CHAT_MODEL };
  const provider = await getProvider(v.provider_id);
  if (provider.isCloud) throw new Error('local_fallback provider must not be a cloud provider');
  return { provider, model: v.model as string };
}

export function clearRegistryCache() {
  roleCache.clear();
  providerCache.clear();
}

export const gateway = createGateway({
  getRoleConfig,
  getProvider,
  getLocalFallback,
  audit: (entry) => writeAudit(entry),
});

/** Embeddings for RAG, via the `embedding` role (local by default). */
export async function embed(texts: string[], ctx: { userId?: string; purpose: string }) {
  const cfg = await getRoleConfig('embedding');
  const provider = await getProvider(cfg.provider_id);
  if (!provider.embed) throw new Error(`Provider ${provider.id} does not support embeddings`);
  if (provider.isCloud) throw new Error('Embeddings must run on a local provider');
  const started = Date.now();
  const vectors = await provider.embed(cfg.model, texts);
  await writeAudit({
    actorUserId: ctx.userId,
    action: 'model_call',
    detail: {
      role: 'embedding',
      purpose: ctx.purpose,
      provider: provider.id,
      model: cfg.model,
      is_cloud: false,
      inputs: texts.length,
      latency_ms: Date.now() - started,
      ok: true,
    },
  });
  return vectors;
}
