import { PRIORITY } from '../llm/gate.js';
import { ATTACHMENT_BUDGET, fitAttachments, type Attachment } from './attachments.js';
import type { LlmGateway } from '../llm/gateway.js';
import { routerSchema, type RouterOutput } from '../llm/schemas.js';
import { callStructured } from '../llm/structured.js';
import type { PromptSpec } from '../prompts/assembler.js';
import { containsHighSensitivityPII, containsPII } from '../privacy/pii.js';
import { clearlyEnglish, guessLanguage, userTurn } from './format.js';

export interface RouterResult extends RouterOutput {
  source: 'model' | 'fallback';
}

export interface RouterDeps {
  gateway: Pick<LlmGateway, 'call'>;
  assemble(spec: PromptSpec): Promise<string>;
}

export async function routeMessage(
  deps: RouterDeps,
  input: {
    question: string;
    departments: Array<{ slug: string; name: string }>;
    defaultDepartment: string;
    userId?: string;
    messageId?: string;
    attachments?: Attachment[];
  },
): Promise<RouterResult> {
  const slugs = input.departments.map((d) => d.slug) as [string, ...string[]];
  // Regex PII detection always runs; the model can only raise sensitivity, never lower it.
  const regexPII = containsPII(input.question);
  const regexHigh = containsHighSensitivityPII(input.question);

  const fallback = (): RouterResult => ({
    department: input.defaultDepartment,
    intent: 'question',
    contains_pii: regexPII,
    sensitivity: regexPII ? 'high' : 'low',
    suggested_mode: /\b(plan|strategy|should we|decide|decision|proposal|rancang|strategi|patut|keputusan|cadangan)\b/i.test(
      input.question,
    )
      ? 'council'
      : 'quick',
    language: guessLanguage(input.question),
    red_flag: 'none',
    red_flag_reason: '',
    reason: 'Router unavailable; heuristic classification.',
    source: 'fallback',
  });

  try {
    const task = await deps.assemble({ base: false, task: 'router' });
    const system = `${task}\n\nAllowed departments:\n${input.departments.map((d) => `- ${d.slug}: ${d.name}`).join('\n')}`;
    const res = await callStructured(
      deps.gateway,
      'router',
      [
        { role: 'system', content: system },
        { role: 'user', content: userTurn(input.question, { attachments: fitAttachments(input.attachments ?? [], ATTACHMENT_BUDGET.router) }) },
      ],
      routerSchema(slugs),
      {
        userId: input.userId,
        messageId: input.messageId,
        // The router itself must never leave the premises: it sees the raw message.
        sensitivity: 'high',
        priority: PRIORITY.quick,
        purpose: 'router',
      },
    );
    if (!res.ok) return fallback();
    const out = res.data;
    const containsPii = out.contains_pii || regexPII;
    return {
      ...out,
      contains_pii: containsPii,
      // An 8B router sometimes calls English "ms" because of Malay names; overrule it when
      // the text has no Malay function words, and trust a strong Malay signal the other way.
      language:
        guessLanguage(input.question) === 'ms' ? 'ms' : out.language === 'ms' && clearlyEnglish(input.question) ? 'en' : out.language,
      sensitivity: regexHigh || containsPii ? 'high' : out.sensitivity,
      source: 'model',
    };
  } catch {
    return fallback();
  }
}
