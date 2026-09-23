import { query } from '../db/pool.js';
import { redis } from '../redis.js';

export type Layer = 'base' | 'persona' | 'department' | 'task';

export interface PromptSpec {
  base?: boolean;
  persona?: string;
  department?: string;
  task: string;
}

export interface AssemblerDeps {
  loadActive(layer: Layer, key: string): Promise<string | null>;
  cacheGet(key: string): Promise<string | null>;
  cacheSet(key: string, value: string): Promise<void>;
  version(): Promise<string>;
}

/** Layered prompt: base → persona → department → task, each a short DB-stored component. */
export function createAssembler(deps: AssemblerDeps) {
  return async function assemble(spec: PromptSpec): Promise<string> {
    const base = spec.base ?? true;
    const cacheKey = `prompt:v${await deps.version()}:${base ? 1 : 0}:${spec.persona ?? '-'}:${spec.department ?? '-'}:${spec.task}`;
    const cached = await deps.cacheGet(cacheKey);
    if (cached) return cached;

    const layers: Array<[Layer, string | undefined]> = [
      ['base', base ? 'default' : undefined],
      ['persona', spec.persona],
      ['department', spec.department],
      ['task', spec.task],
    ];
    const parts: string[] = [];
    for (const [layer, key] of layers) {
      if (!key) continue;
      const content = await deps.loadActive(layer, key);
      if (content === null) {
        if (layer === 'task' || layer === 'persona') throw new Error(`Missing active prompt ${layer}:${key}`);
        continue; // a department without its own layer is fine
      }
      parts.push(content.trim());
    }
    const prompt = parts.join('\n\n');
    await deps.cacheSet(cacheKey, prompt);
    return prompt;
  };
}

export const assemblePrompt = createAssembler({
  async loadActive(layer, key) {
    const { rows } = await query(
      'SELECT content FROM prompt_components WHERE layer = $1 AND key = $2 AND is_active',
      [layer, key],
    );
    return rows[0]?.content ?? null;
  },
  cacheGet: (key) => redis.get(key),
  async cacheSet(key, value) {
    await redis.set(key, value, 'EX', 3600);
  },
  async version() {
    return (await redis.get('prompt:version')) ?? '0';
  },
});

/** Called after any prompt edit: bumping the version orphans every cached assembly. */
export async function invalidatePrompts() {
  await redis.incr('prompt:version');
}
