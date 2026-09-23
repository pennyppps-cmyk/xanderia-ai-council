import type { z } from 'zod';
import { userTurn } from '../council/format.js';
import { query } from '../db/pool.js';
import { PRIORITY } from '../llm/gate.js';
import { gateway, getRoleConfig } from '../llm/registry.js';
import { ClarifySchema, DispatchSchema, ReviewSchema, routerSchema, VerdictSchema } from '../llm/schemas.js';
import { callStructured } from '../llm/structured.js';
import type { Layer } from './assembler.js';

/**
 * "Test this prompt" (HANDOFF §7): run an unsaved draft of one prompt layer exactly the way
 * the real step would use it (same layers, same model role, same JSON schema), without saving.
 */
export interface SandboxInput {
  layer: Layer;
  key: string;
  content: string;
  question: string;
  departmentSlug: string;
  userId: string;
}

const TASK_ROLE: Record<string, string> = {
  quick: 'quick',
  router: 'router',
  council_advisor: 'advisor:contrarian',
  peer_review: 'peer_review',
  chairman: 'chairman',
  clarifier: 'clarifier',
  crew_dispatcher: 'crew:dispatcher',
  crew_herald: 'crew:herald',
  crew_runner: 'crew:runner',
};

function plan(i: SandboxInput) {
  const dept = i.departmentSlug;
  if (i.layer === 'persona') {
    const chair = i.key === 'chairman';
    return {
      base: true,
      persona: i.key,
      department: chair || i.key === 'dept_expert' ? dept : undefined,
      task: chair ? 'chairman' : 'council_advisor',
      role: chair ? 'chairman' : `advisor:${i.key}`,
    };
  }
  if (i.layer === 'task') {
    return {
      base: !['router', 'crew_herald'].includes(i.key),
      persona: i.key === 'quick' ? 'dept_expert' : i.key === 'council_advisor' ? 'contrarian' : i.key === 'chairman' ? 'chairman' : undefined,
      department: ['quick', 'chairman'].includes(i.key) ? dept : undefined,
      task: i.key,
      role: TASK_ROLE[i.key] ?? 'quick',
    };
  }
  // base or department layer: test it through a Quick answer from the department expert
  return { base: true, persona: 'dept_expert', department: i.layer === 'department' ? i.key : dept, task: 'quick', role: 'quick' };
}

async function schemaFor(task: string): Promise<z.ZodType | null> {
  switch (task) {
    case 'router': {
      const { rows } = await query(`SELECT slug FROM departments WHERE is_active`);
      return routerSchema(rows.map((r) => r.slug) as [string, ...string[]]);
    }
    case 'chairman':
      return VerdictSchema;
    case 'clarifier':
      return ClarifySchema;
    case 'peer_review':
      return ReviewSchema;
    case 'crew_dispatcher':
      return DispatchSchema;
    default:
      return null;
  }
}

export async function runPromptSandbox(i: SandboxInput) {
  const p = plan(i);
  const layers: Array<[Layer, string | undefined]> = [
    ['base', p.base ? 'default' : undefined],
    ['persona', p.persona],
    ['department', p.department],
    ['task', p.task],
  ];
  const parts: string[] = [];
  for (const [layer, key] of layers) {
    if (!key) continue;
    if (layer === i.layer && key === i.key) {
      parts.push(i.content.trim());
      continue;
    }
    const { rows } = await query(`SELECT content FROM prompt_components WHERE layer = $1 AND key = $2 AND is_active`, [layer, key]);
    if (rows[0]) parts.push(rows[0].content.trim());
  }
  const system = parts.join('\n\n');
  const role = await getRoleConfig(p.role).then(() => p.role, () => 'quick');
  const messages = [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: userTurn(i.question) },
  ];
  const ctx = { userId: i.userId, sensitivity: 'high' as const, priority: PRIORITY.quick, purpose: 'prompt_sandbox' };
  const schema = await schemaFor(p.task);
  if (schema) {
    const res = await callStructured(gateway, role, messages, schema, ctx);
    return {
      role,
      system,
      output: res.ok ? JSON.stringify(res.data, null, 2) : res.raw,
      structured: { valid: res.ok, attempts: res.attempts, error: res.ok ? null : res.error },
      model: res.outcome?.model,
      latencyMs: res.outcome?.latencyMs,
    };
  }
  const out = await gateway.call(role, messages, ctx);
  return { role, system, output: out.content, structured: null, model: out.model, latencyMs: out.latencyMs };
}
