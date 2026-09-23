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

interface LoadedJob {
  message: {
    id: string;
    conversation_id: string;
    reply_to: string;
    requested_mode: 'auto' | 'quick' | 'council';
    department_id: string;
    options: { peerReview?: boolean };
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
      ORDER BY created_at DESC LIMIT $3`,
    [conversationId, beforeMessageId, turns * 2],
  );
  // Older turns are context only; trim them to protect the context window.
  return rows
    .reverse()
    .map((r) => ({ role: r.role, content: r.content.length > 1500 ? `${r.content.slice(0, 1500)} …` : r.content }));
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
  const { message, user, department, question } = job;

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
    const departments = (await query('SELECT slug, name FROM departments WHERE is_active ORDER BY name')).rows;
    const route = () =>
      routeMessage(
        { gateway, assemble: assemblePrompt },
        { question, departments, defaultDepartment: department.slug, userId: user.id, messageId },
      );

    // Router first when its answer decides something (mode, or whether a cloud role may run);
    // for an explicit Quick question on a local model it runs alongside the answer instead.
    const routerBlocks =
      message.requested_mode !== 'quick' || (await isCloudRole('quick'));
    let router: RouterResult | null = null;
    let routerPromise: Promise<RouterResult> | null = null;
    if (routerBlocks) {
      await stage('router');
      router = await route();
    } else {
      routerPromise = route();
    }

    let mode: 'quick' | 'council' =
      message.requested_mode === 'auto' ? router!.suggested_mode : message.requested_mode;
    if (mode === 'council' && !(await canUseCouncil(user.role))) mode = 'quick';

    const saveRouter = async (r: RouterResult) => {
      await query('UPDATE messages SET router = $2, mode = $3 WHERE id = $1', [messageId, JSON.stringify(r), mode]);
      await events.emit(messageId, { type: 'router', router: r, mode });
    };
    if (router) await saveRouter(router);
    else await query('UPDATE messages SET mode = $2 WHERE id = $1', [messageId, mode]);

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

    const history = await loadHistory(message.conversation_id, message.reply_to, await getSetting('history_turns', 6));
    const sensitivity = router?.sensitivity ?? 'high'; // unknown yet → treat as sensitive

    if (mode === 'quick') {
      await stage('answer');
      const system = await assemblePrompt({ persona: 'dept_expert', department: department.slug, task: 'quick' });
      let stream: TokenStream | undefined;
      await events.emit(messageId, {
        type: 'part_start',
        part: 'answer',
        stage: 0,
        persona: 'dept_expert',
      });
      const out = await gateway.call(
        'quick',
        [
          { role: 'system', content: system },
          ...history,
          { role: 'user', content: userTurn(question, { knowledge }) },
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
      const { rows: personas } = await query(
        'SELECT key, name FROM personas WHERE in_council AND is_active ORDER BY sort_order',
      );
      const result = await runCouncil(
        { gateway, assemble: assemblePrompt, getRoleConfig },
        {
          question,
          history,
          department,
          knowledge,
          language: router?.language ?? 'en',
          sensitivity,
          peerReview: message.options.peerReview ?? (await getSetting('peer_review_default', false)),
          advisors: personas as Advisor[],
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

    if (routerPromise) await saveRouter(await routerPromise);

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
  }
}
