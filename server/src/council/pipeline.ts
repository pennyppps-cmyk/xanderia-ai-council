import { writeAudit } from '../audit.js';
import { pool, query } from '../db/pool.js';
import { PRIORITY } from '../llm/gate.js';
import { embed, gateway, getProvider, getRoleConfig } from '../llm/registry.js';
import type { ChatMessage } from '../llm/types.js';
import { assemblePrompt } from '../prompts/assembler.js';
import type { Publisher, TokenStream } from '../queue/events.js';
import { retrieveForUser, type RetrievedChunk } from '../rag/retrieve.js';
import { canUseCouncil, getSetting, type UserRole } from '../settings.js';
import { runCouncil, type Advisor } from './council.js';
import { toCitations, userTurn, verdictToMarkdown } from './format.js';
import { routeMessage, type RouterResult } from './router.js';
import { notify } from '../crew/service.js';
import { deliverToTelegram } from '../telegram/bot.js';
import { checkClarity, clarifyMarkdown, composeClarifiedQuestion } from './clarify.js';
import { condenseQuestion } from './condense.js';
import { ATTACHMENT_BUDGET, fitAttachments, truncationNote, type Attachment } from './attachments.js';

interface LoadedJob {
  message: {
    id: string;
    conversation_id: string;
    reply_to: string;
    requested_mode: 'auto' | 'quick' | 'council';
    department_id: string;
    options: {
      peerReview?: boolean;
      skipClarify?: boolean;
      template?: string;
      task?: string;
      persona?: string;
      whatIf?: { base: string; change: string };
      effectiveQuestion?: string;
      /** Asked from another channel: send the result back there when done. */
      channel?: 'telegram';
    };
    status: string;
  };
  question: string;
  user: { id: string; role: UserRole; department_id: string };
  department: { id: string; slug: string; name: string };
  conversation: { id: string; title: string };
}

async function load(messageId: string): Promise<LoadedJob | null> {
  const { rows } = await query(
    `SELECT m.id, m.conversation_id, m.reply_to, m.requested_mode, m.department_id, m.options, m.status,
            q.content AS question,
            u.id AS user_id, u.role AS user_role, u.department_id AS user_department_id,
            d.slug AS dept_slug, d.name AS dept_name,
            c.title AS conv_title
       FROM messages m
       JOIN messages q ON q.id = m.reply_to
       JOIN conversations c ON c.id = m.conversation_id
       JOIN users u ON u.id = c.user_id
       JOIN departments d ON d.id = m.department_id
      WHERE m.id = $1`,
    [messageId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    message: r,
    question: r.question,
    user: { id: r.user_id, role: r.user_role, department_id: r.user_department_id },
    department: { id: r.department_id, slug: r.dept_slug, name: r.dept_name },
    conversation: { id: r.conversation_id, title: r.conv_title },
  };
}

async function loadHistory(conversationId: string, beforeMessageId: string, turns: number): Promise<ChatMessage[]> {
  const { rows } = await query(
    `SELECT role, content FROM messages
      WHERE conversation_id = $1 AND status = 'done' AND content <> ''
        AND created_at < (SELECT created_at FROM messages WHERE id = $2)
      ORDER BY created_at DESC, (role = 'assistant') DESC LIMIT $3`,
    [conversationId, beforeMessageId, turns * 2],
  );
  // Older turns are context only; trim them to protect the context window.
  return rows
    .reverse()
    .map((r) => ({ role: r.role, content: r.content.length > 1500 ? `${r.content.slice(0, 1500)} …` : r.content }));
}

/** The assistant message immediately before a given user message (the previous turn's answer). */
async function previousAssistant(conversationId: string, userMessageId: string) {
  const { rows } = await query(
    `SELECT a.id, a.mode, a.options, a.reply_to, q.content AS original_question
       FROM messages a JOIN messages q ON q.id = a.reply_to
      WHERE a.conversation_id = $1 AND a.role = 'assistant'
        AND a.created_at < (SELECT created_at FROM messages WHERE id = $2)
      ORDER BY a.created_at DESC LIMIT 1`,
    [conversationId, userMessageId],
  );
  return rows[0] ?? null;
}

const WHAT_IF_RERUN = ['contrarian', 'executor'];

/** Text of the documents attached to the given user messages, oldest first. */
async function loadAttachments(messageIds: Array<string | null | undefined>): Promise<Attachment[]> {
  const ids = [...new Set(messageIds.filter(Boolean))] as string[];
  if (!ids.length) return [];
  const { rows } = await query(`SELECT filename, text FROM attachments WHERE message_id = ANY($1::uuid[]) ORDER BY created_at`, [ids]);
  return rows.map((r) => ({ name: r.filename, text: r.text }));
}

/** The original council run a what-if builds on (must belong to the same user). */
async function loadWhatIfBase(baseId: string, userId: string) {
  const { rows } = await query(
    `SELECT m.verdict FROM messages m JOIN conversations c ON c.id = m.conversation_id
      WHERE m.id = $1 AND c.user_id = $2 AND m.mode = 'council' AND m.verdict IS NOT NULL`,
    [baseId, userId],
  );
  if (!rows[0]) throw new Error('The verdict this what-if builds on is no longer available');
  const { rows: parts } = await query(
    `SELECT p.persona_key, p.content, pe.name FROM message_parts p JOIN personas pe ON pe.key = p.persona_key
      WHERE p.message_id = $1 AND p.stage = 1 AND p.content <> ''`,
    [baseId],
  );
  return {
    verdict: rows[0].verdict.verdict as string,
    opinions: parts.map((p) => ({ advisor: { key: p.persona_key, name: `${p.name} (original run)` }, label: '-', content: p.content })),
  };
}

/** Quick-mode tasks and the model role each runs on (documents need a larger output budget). */
const QUICK_TASKS: Record<string, string> = { quick: 'quick', script_check: 'quick', document: 'document' };

/** Log a red-flagged request and alert Compliance (admins and Legal & Compliance leads). */
async function raiseRedFlag(messageId: string, userId: string, router: RouterResult) {
  await writeAudit({
    actorUserId: userId,
    action: 'red_flag',
    targetType: 'message',
    targetId: messageId,
    detail: { flag: router.red_flag, reason: router.red_flag_reason },
  });
  const { rows } = await query(
    `SELECT u.id FROM users u LEFT JOIN departments d ON d.id = u.department_id
      WHERE u.is_active AND u.id <> $1 AND (u.role = 'admin' OR (u.role = 'dept_lead' AND d.slug = 'legal-compliance'))`,
    [userId],
  );
  for (const r of rows) {
    await notify(r.id, {
      kind: 'red_flag',
      title: `Compliance flag (${router.red_flag.replace('_', ' ')}): a request needs review`,
      body: router.red_flag_reason || undefined,
      link: '/admin/audit',
    });
  }
}

async function isCloudRole(role: string) {
  const cfg = await getRoleConfig(role);
  return (await getProvider(cfg.provider_id)).isCloud;
}

async function setStatus(messageId: string, status: string, stage?: string | null) {
  await query('UPDATE messages SET status = $2, stage = $3 WHERE id = $1', [messageId, status, stage ?? null]);
}

export async function processMessage(messageId: string, events: Publisher) {
  const job = await load(messageId);
  if (!job || job.message.status === 'done') return;
  const { message, user, department } = job;
  // A what-if carries the original question plus the changed assumption.
  let question = message.options.whatIf && message.options.effectiveQuestion ? message.options.effectiveQuestion : job.question;

  // A retried job (worker crash) starts clean.
  await query('DELETE FROM message_parts WHERE message_id = $1', [messageId]);
  await events.clearPartials(messageId);

  let started = false;
  const onQueued = (position: number) => {
    if (!started) void events.emit(messageId, { type: 'status', status: 'queued', position });
  };
  const stage = async (name: string) => {
    await setStatus(messageId, 'running', name);
    await events.emit(messageId, { type: 'status', status: 'running', stage: name });
  };
  const streams = new Map<string, TokenStream>();
  const streamFor = (part: string) => {
    started = true; // first token: no longer "queued"
    let s = streams.get(part);
    if (!s) streams.set(part, (s = events.tokenStream(messageId, part)));
    return s;
  };

  try {
    // Is this the asker's reply to the council's clarifying questions? Then the council considers
    // the original question plus the answers, and the clarifying exchange is not repeated as history.
    let historyAnchor = message.reply_to;
    let answeringClarify = false;
    const prev = await previousAssistant(message.conversation_id, message.reply_to);
    if (prev?.mode === 'clarify' && prev.options?.clarify) {
      question = composeClarifiedQuestion(prev.original_question, prev.options.clarify, job.question, Boolean(message.options.skipClarify));
      historyAnchor = prev.reply_to;
      answeringClarify = true;
      await query(`UPDATE messages SET options = options || $2 WHERE id = $1`, [
        messageId,
        JSON.stringify({ effectiveQuestion: question, clarifiedFrom: prev.id }),
      ]);
    }

    // Documents attached to this question (or, when answering clarifying questions, to the original one).
    const attachments = await loadAttachments([message.reply_to, historyAnchor]);
    const attachmentNote = truncationNote(attachments);
    if (attachments.length) {
      await query(`UPDATE messages SET options = options || $2 WHERE id = $1`, [
        messageId,
        JSON.stringify({ attachmentNames: attachments.map((a) => a.name), ...(attachmentNote ? { attachmentNote } : {}) }),
      ]);
    }

    // The conversation so far (advisors and Quick answers see it directly).
    const history = await loadHistory(message.conversation_id, historyAnchor, await getSetting('history_turns', 6));

    // A short follow-up ("i meant the council") is rewritten into a standalone question first,
    // because the router, the clarifier and the knowledge search only see this one message.
    if (!answeringClarify && !message.options.whatIf && history.length) {
      await stage('router');
      const c = await condenseQuestion({ gateway, assemble: assemblePrompt }, { question, history, userId: user.id, messageId });
      if (c.rewritten) {
        question = c.question;
        await query(`UPDATE messages SET options = options || $2 WHERE id = $1`, [
          messageId,
          JSON.stringify({ effectiveQuestion: question, understoodFromFollowUp: true }),
        ]);
      }
    }

    const departments = (await query('SELECT slug, name FROM departments WHERE is_active ORDER BY name')).rows;
    const route = () =>
      routeMessage(
        { gateway, assemble: assemblePrompt },
        { question, departments, defaultDepartment: department.slug, userId: user.id, messageId, attachments },
      );

    // Router first when its answer decides something (mode, or whether a cloud role may run);
    // for an explicit Quick question on a local model it runs alongside the answer instead.
    const routerBlocks =
      answeringClarify || message.requested_mode !== 'quick' || (await isCloudRole('quick'));
    let router: RouterResult | null = null;
    let routerPromise: Promise<RouterResult> | null = null;
    if (routerBlocks) {
      await stage('router');
      router = await route();
    } else {
      routerPromise = route();
    }

    let mode: 'quick' | 'council' = answeringClarify
      ? 'council'
      : message.requested_mode === 'auto'
        ? router!.suggested_mode
        : message.requested_mode;
    if (mode === 'council' && !(await canUseCouncil(user.role))) mode = 'quick';

    const saveRouter = async (r: RouterResult) => {
      await query('UPDATE messages SET router = $2, mode = $3 WHERE id = $1', [messageId, JSON.stringify(r), mode]);
      await events.emit(messageId, { type: 'router', router: r, mode });
    };
    if (router) await saveRouter(router);
    if (router?.red_flag && router.red_flag !== 'none') await raiseRedFlag(messageId, user.id, router);
    else await query('UPDATE messages SET mode = $2 WHERE id = $1', [messageId, mode]);

    // Before convening the council, ask the asker for anything essential that is missing.
    if (mode === 'council' && !answeringClarify && !message.options.skipClarify && (await getSetting('clarify_enabled', true))) {
      await stage('clarify');
      const clarify = await checkClarity(
        { gateway, assemble: assemblePrompt },
        { question, departmentName: department.name, sensitivity: router?.sensitivity ?? 'high', userId: user.id, messageId, attachments },
      );
      if (clarify) {
        const content = clarifyMarkdown(clarify);
        await query(
          `UPDATE messages SET mode = 'clarify', content = $2, options = options || $3,
                  status = 'done', stage = NULL, completed_at = now() WHERE id = $1`,
          [messageId, content, JSON.stringify({ clarify })],
        );
        await query('UPDATE conversations SET updated_at = now() WHERE id = $1', [message.conversation_id]);
        await events.emit(messageId, { type: 'clarify', clarify, content });
        await events.emit(messageId, { type: 'status', status: 'done' });
        await events.emit(messageId, { type: 'done' });
        await events.notifyUser(user.id, {
          type: 'job_done',
          conversationId: message.conversation_id,
          messageId,
          mode: 'clarify',
          title: job.conversation.title,
        });
        return;
      }
    }

    // Knowledge: the user's own department + grants + company-wide, whatever department they asked.
    let knowledge: RetrievedChunk[] = [];
    if (await getSetting('rag_enabled', true)) {
      try {
        knowledge = await retrieveForUser(
          { db: pool, embed: (t) => embed(t, { userId: user.id, purpose: 'rag_query' }) },
          user,
          question,
          await getSetting('rag_top_k', 5),
        );
        if (knowledge.length) {
          await writeAudit({
            actorUserId: user.id,
            action: 'rag_retrieval',
            targetType: 'message',
            targetId: messageId,
            detail: { documents: [...new Set(knowledge.map((k) => k.documentId))], chunks: knowledge.length },
          });
        }
      } catch (err) {
        console.warn(`[pipeline] retrieval skipped: ${(err as Error).message}`);
      }
    }
    const citations = toCitations(knowledge);
    // Only list sources the answer actually cites ([S1] …), not everything retrieved.
    const saveCitations = async (answerText: string) => {
      const used = citations.filter((c) => answerText.includes(`[${c.id}]`));
      if (!used.length) return;
      await query('UPDATE messages SET citations = $2 WHERE id = $1', [messageId, JSON.stringify(used)]);
      await events.emit(messageId, { type: 'citations', citations: used });
    };

    const sensitivity = router?.sensitivity ?? 'high'; // unknown yet → treat as sensitive

    if (mode === 'quick') {
      await stage('answer');
      // Templates can swap the task (script check, document drafting) and the persona; only known keys are allowed.
      const task = message.options.task && QUICK_TASKS[message.options.task] ? message.options.task : 'quick';
      const persona = message.options.persona && ['dept_expert', 'customer_advocate', 'compliance'].includes(message.options.persona) ? message.options.persona : 'dept_expert';
      const system = await assemblePrompt({ persona, department: department.slug, task });
      let stream: TokenStream | undefined;
      await events.emit(messageId, {
        type: 'part_start',
        part: 'answer',
        stage: 0,
        persona: 'dept_expert',
      });
      const out = await gateway.call(
        QUICK_TASKS[task],
        [
          { role: 'system', content: system },
          ...history,
          { role: 'user', content: userTurn(question, { knowledge, attachments: fitAttachments(attachments, ATTACHMENT_BUDGET.answer) }) },
        ],
        {
          userId: user.id,
          messageId,
          sensitivity,
          priority: PRIORITY.quick,
          onQueued,
          onToken: (t) => (stream ??= streamFor('answer')).push(t),
          purpose: 'quick',
        },
      );
      await stream?.flush();
      await query(
        `UPDATE messages SET content = $2, cloud_used = $3 WHERE id = $1`,
        [messageId, out.content.trim(), out.isCloud],
      );
      await events.emit(messageId, { type: 'part_done', part: 'answer', content: out.content.trim() });
      await saveCitations(out.content);
    } else {
      // The Compliance Officer joins for regulated departments, and whenever the router raised a red flag.
      const seatDepts = await getSetting<string[]>('compliance_seat_departments', []);
      const withCompliance = seatDepts.includes(department.slug) || (router?.red_flag && router.red_flag !== 'none');
      // What-if: re-run only the Contrarian and the Executor on the changed assumption; the other
      // advisors' opinions carry over from the original run, and the Chairman updates the verdict.
      const whatIf = message.options.whatIf ? await loadWhatIfBase(message.options.whatIf.base, user.id) : null;
      const { rows: personas } = await query(
        `SELECT key, name FROM personas
          WHERE is_active AND (in_council OR (key = 'compliance' AND $1))
          ORDER BY sort_order`,
        [Boolean(withCompliance)],
      );
      const result = await runCouncil(
        { gateway, assemble: assemblePrompt, getRoleConfig },
        {
          question,
          history,
          department,
          knowledge,
          attachments,
          language: router?.language ?? 'en',
          sensitivity,
          peerReview: message.options.peerReview ?? (await getSetting('peer_review_default', false)),
          advisors: whatIf ? (personas as Advisor[]).filter((p) => WHAT_IF_RERUN.includes(p.key)) : (personas as Advisor[]),
          priorOpinions: whatIf?.opinions.filter((o) => !WHAT_IF_RERUN.includes(o.advisor.key)),
          chairmanNote: whatIf
            ? `WHAT-IF RE-RUN. The user changed one assumption: "${message.options.whatIf!.change}". The previous verdict was: "${whatIf.verdict}". ` +
              'Opinions from advisors who did not re-run are from the original run. Update the verdict for the changed assumption, and say explicitly in "why" what changed compared with the previous verdict and why.'
            : undefined,
          userId: user.id,
          messageId,
        },
        {
          onStage: (s) => stage(s),
          onQueued,
          onPartStart: async (part, st, advisor, label) => {
            await events.emit(messageId, { type: 'part_start', part, stage: st, persona: advisor.key, label });
          },
          onToken: (part, t) => streamFor(part).push(t),
          onPartDone: async (part, st, advisor, p) => {
            await streamFor(part).flush();
            if (st !== 3) {
              await query(
                `INSERT INTO message_parts (message_id, stage, kind, persona_key, anon_label, content, data, model, latency_ms)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [
                  messageId,
                  st,
                  st === 1 ? 'opinion' : 'review',
                  advisor.key,
                  p.label ?? null,
                  p.content,
                  JSON.stringify({ ...((p.data as object) ?? {}), error: p.error ?? null }),
                  p.model ?? null,
                  p.latencyMs ?? null,
                ],
              );
            }
            await events.emit(messageId, { type: 'part_done', part, content: p.content, data: p.data, error: p.error });
          },
        },
      );
      const content = result.verdict ? verdictToMarkdown(result.verdict) : result.verdictRaw.trim();
      await query(
        `UPDATE messages SET content = $2, verdict = $3, cloud_used = $4 WHERE id = $1`,
        [messageId, content, result.verdict ? JSON.stringify(result.verdict) : null, result.cloudUsed],
      );
      await events.emit(messageId, { type: 'verdict', verdict: result.verdict, raw: result.verdict ? undefined : content });
      await saveCitations([content, ...result.opinions.map((o) => o.content)].join('\n'));
    }

    if (routerPromise) {
      const late = await routerPromise;
      await saveRouter(late);
      if (late.red_flag && late.red_flag !== 'none') await raiseRedFlag(messageId, user.id, late);
    }

    await query(`UPDATE messages SET status = 'done', stage = NULL, completed_at = now() WHERE id = $1`, [messageId]);
    await query('UPDATE conversations SET updated_at = now() WHERE id = $1', [message.conversation_id]);
    await events.emit(messageId, { type: 'status', status: 'done' });
    await events.emit(messageId, { type: 'done' });
    await events.notifyUser(user.id, {
      type: 'job_done',
      conversationId: message.conversation_id,
      messageId,
      mode,
      title: job.conversation.title,
    });
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`[pipeline] message ${messageId} failed:`, err);
    await query(`UPDATE messages SET status = 'error', error = $2, completed_at = now() WHERE id = $1`, [messageId, msg]);
    await events.emit(messageId, { type: 'error', message: msg });
    await events.notifyUser(user.id, { type: 'job_failed', conversationId: message.conversation_id, messageId });
  } finally {
    await events.clearPartials(messageId).catch(() => {});
    if (message.options.channel === 'telegram') {
      await deliverToTelegram(messageId).catch((err) => console.error('[telegram] delivery failed:', err));
    }
  }
}
