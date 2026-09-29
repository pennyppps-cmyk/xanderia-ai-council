import { PRIORITY } from '../llm/gate.js';
import { transcript } from './condense.js';
import { factsBlock } from './facts.js';
import { ATTACHMENT_BUDGET, fitAttachments, type Attachment } from './attachments.js';
import type { CallContext, LlmGateway, Sensitivity } from '../llm/gateway.js';
import { ReviewSchema, VerdictSchema, type ReviewOutput, type Verdict } from '../llm/schemas.js';
import { callStructured } from '../llm/structured.js';
import type { ChatMessage, RoleConfig } from '../llm/types.js';
import type { PromptSpec } from '../prompts/assembler.js';
import type { RetrievedChunk } from '../rag/retrieve.js';
import { advisorBlock, parseStance, userTurn } from './format.js';

export interface Advisor {
  key: string;
  name: string;
}

export interface CouncilInput {
  /** What-if runs: opinions carried over from the original run (only some advisors re-run). */
  priorOpinions?: Opinion[];
  /** Extra instruction for the Chairman (e.g. "this is a what-if: update the previous verdict"). */
  chairmanNote?: string;
  question: string;
  history: ChatMessage[];
  department: { slug: string; name: string };
  knowledge: RetrievedChunk[];
  /** Documents the asker attached (their plan, proposal or data). */
  attachments?: Attachment[];
  /** What the asker already confirmed in this conversation (clarifying and open-question answers). */
  facts?: string[];
  /** Company memory: house rules, approved answers and lessons from past decisions. */
  memory?: string;
  language: 'en' | 'ms';
  sensitivity: Sensitivity;
  peerReview: boolean;
  advisors: Advisor[];
  userId?: string;
  messageId?: string;
}

export interface Opinion {
  advisor: Advisor;
  label: string; // anonymous label used in stage 2
  content: string;
  model?: string;
  latencyMs?: number;
  error?: string;
}

export interface Review {
  reviewer: Advisor;
  content: string;
  data?: ReviewOutput;
  /** Scores keyed by the *reviewed* advisor's key (de-anonymised after the fact). */
  scores: Record<string, { score: number; flaw: string }>;
  error?: string;
}

export interface CouncilResult {
  opinions: Opinion[];
  reviews: Review[];
  verdict: Verdict | null;
  verdictRaw: string;
  cloudUsed: boolean;
}

export interface CouncilHooks {
  onStage(stage: 'stage1' | 'stage2' | 'stage3'): Promise<void> | void;
  onQueued?(position: number): void;
  onPartStart(part: string, stage: number, advisor: Advisor, label?: string): Promise<void> | void;
  onToken(part: string, text: string): void;
  onPartDone(
    part: string,
    stage: number,
    advisor: Advisor,
    payload: { content: string; label?: string; data?: unknown; model?: string; latencyMs?: number; error?: string },
  ): Promise<void> | void;
}

export interface CouncilDeps {
  gateway: Pick<LlmGateway, 'call'>;
  assemble(spec: PromptSpec): Promise<string>;
  getRoleConfig(role: string): Promise<RoleConfig>;
  /** Shuffle used for anonymisation; injectable so tests are deterministic. */
  shuffle?<T>(items: T[]): T[];
}

const LABELS = 'ABCDEFGHIJ'.split('');

function defaultShuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Rough token estimate for Hermes/Llama tokenisers on mixed English/Malay text. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 3.5);

/**
 * Keep the Chairman's input inside its context window: if all opinions + reviews
 * don't fit, trim each opinion to an equal share of the budget.
 */
export function condenseForChairman(opinions: Opinion[], reviewsText: string, budgetTokens: number) {
  const full = opinions.map((o) => o.content);
  const total = estimateTokens(full.join('\n') + reviewsText);
  if (total <= budgetTokens) return { texts: full, condensed: false };
  const perOpinionChars = Math.max(
    400,
    Math.floor(((budgetTokens - estimateTokens(reviewsText)) * 3.5) / Math.max(1, opinions.length)),
  );
  return {
    texts: full.map((t) => (t.length > perOpinionChars ? `${t.slice(0, perOpinionChars)} …[condensed]` : t)),
    condensed: true,
  };
}

export async function runCouncil(deps: CouncilDeps, input: CouncilInput, hooks: CouncilHooks): Promise<CouncilResult> {
  const shuffle = deps.shuffle ?? defaultShuffle;
  let cloudUsed = false;
  const baseCtx = (purpose: string): CallContext => ({
    userId: input.userId,
    messageId: input.messageId,
    sensitivity: input.sensitivity,
    priority: PRIORITY.council,
    onQueued: hooks.onQueued,
    purpose,
  });

  // ── Stage 1: independent opinions, in parallel (the gate limits real concurrency) ──
  await hooks.onStage('stage1');
  const labels = shuffle(LABELS.slice(0, input.advisors.length));
  const departmentContext = [
    `Context: this request was routed to the ${input.department.name} department of Xanderia.`,
    factsBlock(input.facts ?? []),
    input.memory ?? '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const opinions: Opinion[] = await Promise.all(
    input.advisors.map(async (advisor, i): Promise<Opinion> => {
      const part = `s1:${advisor.key}`;
      const label = labels[i];
      await hooks.onPartStart(part, 1, advisor, label);
      try {
        const isExpert = advisor.key === 'dept_expert';
        // The Compliance Officer also reads the knowledge base (policies are usually company-wide).
        const readsKnowledge = isExpert || advisor.key === 'compliance';
        const system = await deps.assemble({
          persona: advisor.key,
          department: isExpert ? input.department.slug : undefined,
          task: 'council_advisor',
        });
        const messages: ChatMessage[] = [
          { role: 'system', content: system },
          ...input.history,
          {
            role: 'user',
            content: userTurn(input.question, {
              attachments: fitAttachments(input.attachments ?? [], ATTACHMENT_BUDGET.answer),
              context: departmentContext,
              knowledge: readsKnowledge ? input.knowledge : [],
            }),
          },
        ];
        const out = await deps.gateway.call(`advisor:${advisor.key}`, messages, {
          ...baseCtx(`advisor:${advisor.key}`),
          onToken: (t) => hooks.onToken(part, t),
        });
        cloudUsed ||= out.isCloud;
        const content = out.content.trim();
        await hooks.onPartDone(part, 1, advisor, {
          content,
          label,
          data: { stance: parseStance(content) },
          model: out.model,
          latencyMs: out.latencyMs,
        });
        return { advisor, label, content, model: out.model, latencyMs: out.latencyMs };
      } catch (err) {
        const error = (err as Error).message;
        await hooks.onPartDone(part, 1, advisor, { content: '', label, error });
        return { advisor, label, content: '', error };
      }
    }),
  );

  const good = [...opinions.filter((o) => !o.error && o.content), ...(input.priorOpinions ?? [])];
  if (good.length < 2) {
    throw new Error(
      `Council needs at least 2 advisor opinions, got ${good.length}. ${opinions.find((o) => o.error)?.error ?? ''}`.trim(),
    );
  }

  // ── Stage 2 (optional): anonymised peer review ──
  const reviews: Review[] = [];
  if (input.peerReview) {
    await hooks.onStage('stage2');
    const byLabel = new Map(good.map((o) => [o.label, o]));
    const results = await Promise.all(
      good.map(async (self): Promise<Review> => {
        const part = `s2:${self.advisor.key}`;
        await hooks.onPartStart(part, 2, self.advisor);
        const others = good.filter((o) => o !== self).sort((a, b) => a.label.localeCompare(b.label));
        try {
          const system = await deps.assemble({ persona: self.advisor.key, task: 'peer_review' });
          const messages: ChatMessage[] = [
            { role: 'system', content: system },
            {
              role: 'user',
              content: `${userTurn(input.question)}\n\nAnswers to review:\n${others
                .map((o) => advisorBlock(`Advisor ${o.label}`, o.content))
                .join('\n')}\n\nReview each of: ${others.map((o) => `Advisor ${o.label}`).join(', ')}.`,
            },
          ];
          const res = await callStructured(deps.gateway, 'peer_review', messages, ReviewSchema, baseCtx('peer_review'));
          cloudUsed ||= Boolean(res.outcome?.isCloud);
          const scores: Review['scores'] = {};
          if (res.ok) {
            for (const r of res.data.reviews) {
              const label = r.advisor.replace(/^advisor\s*/i, '').trim().toUpperCase().slice(0, 1);
              const reviewed = byLabel.get(label);
              if (reviewed && reviewed !== self) scores[reviewed.advisor.key] = { score: r.score, flaw: r.biggest_flaw };
            }
          }
          const review: Review = {
            reviewer: self.advisor,
            content: res.raw,
            data: res.ok ? res.data : undefined,
            scores,
            error: res.ok ? undefined : res.error,
          };
          await hooks.onPartDone(part, 2, self.advisor, {
            content: res.raw,
            data: { scores, parsed: res.ok ? res.data : null },
            model: res.outcome?.model,
            latencyMs: res.outcome?.latencyMs,
            error: review.error,
          });
          return review;
        } catch (err) {
          const error = (err as Error).message;
          await hooks.onPartDone(part, 2, self.advisor, { content: '', error });
          return { reviewer: self.advisor, content: '', scores: {}, error };
        }
      }),
    );
    reviews.push(...results);
  }

  // ── Stage 3: Chairman adjudicates ──
  await hooks.onStage('stage3');
  const chairman: Advisor = { key: 'chairman', name: 'The Chairman' };
  await hooks.onPartStart('chairman', 3, chairman);

  let reviewsText = '';
  if (reviews.length) {
    const agg = new Map<string, { total: number; n: number; flaws: string[] }>();
    for (const r of reviews) {
      for (const [key, s] of Object.entries(r.scores)) {
        const a = agg.get(key) ?? { total: 0, n: 0, flaws: [] };
        a.total += s.score;
        a.n += 1;
        a.flaws.push(s.flaw);
        agg.set(key, a);
      }
    }
    reviewsText = good
      .map((o) => {
        const a = agg.get(o.advisor.key);
        if (!a) return `- ${o.advisor.name}: no peer scores`;
        return `- ${o.advisor.name}: average peer score ${(a.total / a.n).toFixed(1)}/5. Flaws raised: ${a.flaws.map((f) => `"${f}"`).join('; ')}`;
      })
      .join('\n');
    // Votes for the strongest answer, and what the reviewers say every answer missed.
    const byLabel = new Map(good.map((o) => [o.label, o]));
    const votes = new Map<string, number>();
    for (const r of reviews) {
      const label = r.data?.strongest.replace(/^advisor\s*/i, '').trim().toUpperCase().slice(0, 1);
      const o = label ? byLabel.get(label) : undefined;
      if (o) votes.set(o.advisor.name, (votes.get(o.advisor.name) ?? 0) + 1);
    }
    if (votes.size) {
      reviewsText += `\nVoted strongest answer: ${[...votes.entries()].sort((a, b) => b[1] - a[1]).map(([n, v]) => `${n} (${v})`).join(', ')}`;
    }
    const missed = reviews.map((r) => r.data?.all_missed?.trim() ?? '').filter((m) => m && !/^nothing\b/i.test(m));
    if (missed.length) reviewsText += `\nWhat the reviewers say ALL answers missed (use for blind_spots):\n${missed.map((m) => `- ${m}`).join('\n')}`;
  }

  const cfg = await deps.getRoleConfig('chairman');
  const system =
    (await deps.assemble({ persona: 'chairman', department: input.department.slug, task: 'chairman' })) +
    (input.language === 'ms'
      ? '\n\nThe user wrote in Bahasa Malaysia: write every text field of the verdict in Bahasa Malaysia.'
      : '\n\nWrite every text field of the verdict in English.') +
    (input.chairmanNote ? `\n\n${input.chairmanNote}` : '');
  // The recent conversation, so the verdict fits what was already discussed (context only).
  const recent = input.history.length ? transcript(input.history, 3, 500) : '';
  // Budget: context minus output, system prompt, schema, question and conversation overhead.
  const chairDocs = fitAttachments(input.attachments ?? [], ATTACHMENT_BUDGET.chairman);
  const budget =
    cfg.num_ctx - cfg.num_predict - estimateTokens(system + input.question + recent + chairDocs.map((a) => a.text).join('')) - 1200;
  const { texts } = condenseForChairman(good, reviewsText, budget);

  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    {
      role: 'user',
      content: `${recent ? `Conversation so far (context only):\n<conversation>\n${recent}\n</conversation>\n\n` : ''}${userTurn(input.question, { context: departmentContext, attachments: chairDocs })}\n\nCouncil opinions:\n${good
        .map((o, i) => advisorBlock(o.advisor.name, texts[i]))
        .join('\n')}${reviewsText ? `\n\nPeer review summary:\n${reviewsText}` : ''}\n\nNow adjudicate and return the verdict JSON.`,
    },
  ];

  const res = await callStructured(deps.gateway, 'chairman', messages, VerdictSchema, {
    ...baseCtx('chairman'),
    priority: PRIORITY.council,
    onToken: (t) => hooks.onToken('chairman', t),
  });
  cloudUsed ||= Boolean(res.outcome?.isCloud);
  await hooks.onPartDone('chairman', 3, chairman, {
    content: res.raw,
    model: res.outcome?.model,
    latencyMs: res.outcome?.latencyMs,
    error: res.ok ? undefined : res.error,
  });

  return {
    opinions,
    reviews,
    verdict: res.ok ? res.data : null,
    verdictRaw: res.raw,
    cloudUsed,
  };
}
