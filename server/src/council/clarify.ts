import { ATTACHMENT_BUDGET, fitAttachments, type Attachment } from './attachments.js';
import { PRIORITY } from '../llm/gate.js';
import type { LlmGateway, Sensitivity } from '../llm/gateway.js';
import { ClarifySchema, type ClarifyOutput } from '../llm/schemas.js';
import { callStructured } from '../llm/structured.js';
import type { PromptSpec } from '../prompts/assembler.js';
import { userTurn } from './format.js';

export interface ClarifyRequest {
  questions: string[];
  assumptions: string[];
}

/**
 * Intake check before convening the council. Returns the questions to ask, or null when the
 * request is clear enough (or the check itself fails: never block the council on it).
 */
export async function checkClarity(
  deps: { gateway: Pick<LlmGateway, 'call'>; assemble(spec: PromptSpec): Promise<string> },
  input: { question: string; departmentName: string; sensitivity: Sensitivity; userId?: string; messageId?: string; attachments?: Attachment[] },
): Promise<ClarifyRequest | null> {
  try {
    const system = await deps.assemble({ task: 'clarifier' });
    const res = await callStructured<ClarifyOutput>(
      deps.gateway,
      'clarifier',
      [
        { role: 'system', content: system },
        {
          role: 'user',
          content: userTurn(input.question, {
            context: `Context: request for the ${input.departmentName} department.`,
            attachments: fitAttachments(input.attachments ?? [], ATTACHMENT_BUDGET.clarify),
          }),
        },
      ],
      ClarifySchema,
      {
        userId: input.userId,
        messageId: input.messageId,
        sensitivity: input.sensitivity,
        priority: PRIORITY.quick,
        purpose: 'clarifier',
      },
    );
    if (!res.ok || !res.data.needs_clarification) return null;
    const questions = res.data.questions.map((q) => q.trim()).filter(Boolean).slice(0, 3);
    if (!questions.length) return null;
    return { questions, assumptions: res.data.assumptions_if_skipped.map((a) => a.trim()).filter(Boolean).slice(0, 4) };
  } catch {
    return null;
  }
}

/** Markdown shown (and stored as content) for a clarifying-questions message. */
export function clarifyMarkdown(c: ClarifyRequest) {
  const lines = ['Before the council meets, a few questions so the advice fits your situation:', ''];
  c.questions.forEach((q, i) => lines.push(`${i + 1}. ${q}`));
  if (c.assumptions.length) {
    lines.push('', 'If you skip, the council will assume:');
    for (const a of c.assumptions) lines.push(`- ${a}`);
  }
  return lines.join('\n');
}

/** The request the council actually considers: the original question plus the asker's answers. */
export function composeClarifiedQuestion(original: string, clarify: ClarifyRequest, reply: string, skipped: boolean) {
  if (skipped) {
    return `${original}\n\nThe asker chose not to add details.${
      clarify.assumptions.length ? ` Proceed on these assumptions: ${clarify.assumptions.map((a) => `(${a})`).join(' ')}` : ''
    }`;
  }
  return `${original}\n\nThe council asked:\n${clarify.questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}\n\nThe asker answered:\n${reply}`;
}
