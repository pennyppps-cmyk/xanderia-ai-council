import { createHash, randomBytes } from 'node:crypto';
import { writeAudit } from '../audit.js';
import { config } from '../config.js';
import { verdictToMarkdown } from '../council/format.js';
import { query, tx } from '../db/pool.js';
import type { Verdict } from '../llm/schemas.js';
import { enqueueMessage } from '../queue/queue.js';
import { redis } from '../redis.js';
import { canUseCouncil } from '../settings.js';
import { transcribe, voiceEnabled } from '../voice/transcribe.js';

/**
 * Telegram bot: staff ask the council from Telegram. The worker long-polls Telegram (outbound
 * HTTPS only, no public URL); each question runs through the normal pipeline (router, PII guard,
 * audit, RAG), and the answer is sent back when it finishes.
 *
 * Linking: the web app issues a one-time code (15 minutes); /start <code> links the chat to that
 * user. Only private chats with a linked, active user are answered.
 */
export const telegramEnabled = () => Boolean(config.TELEGRAM_BOT_TOKEN);
const MAX = 4000; // Telegram's limit is 4096 characters per message
const CONVERSATION_TTL = 6 * 3600; // follow-ups within 6 hours continue the same conversation

export type TgCall = (method: string, params?: Record<string, unknown>) => Promise<any>;

export function telegramApi(token: string, fetchImpl: typeof fetch = fetch): TgCall {
  return async (method, params = {}) => {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(70_000),
    });
    const data = (await res.json()) as { ok: boolean; result?: unknown; description?: string };
    if (!data.ok) throw new Error(`Telegram ${method}: ${data.description ?? res.status}`);
    return data.result;
  };
}

let api: TgCall | null = null;
const tg = () => (api ??= telegramApi(config.TELEGRAM_BOT_TOKEN!));
/** For tests. */
export function setTelegramApi(call: TgCall | null) {
  api = call;
}

/** Plain text for Telegram: no Markdown parse mode (model output would break it), light cleanup. */
export function toPlainText(md: string) {
  return md
    .replace(/^#{1,6}\s+(.*)$/gm, (_, h: string) => h.toUpperCase())
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|\s)\*([^*\s][^*]*)\*/g, '$1$2')
    .replace(/^[ \t]*[-*][ \t]+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Split on paragraph / line boundaries into Telegram-sized pieces. */
export function splitMessage(text: string, max = MAX): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n\n', max);
    if (cut < max / 2) cut = rest.lastIndexOf('\n', max);
    if (cut < max / 2) cut = rest.lastIndexOf(' ', max);
    if (cut <= 0) cut = max;
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}

export async function send(chatId: number | string, text: string) {
  for (const part of splitMessage(text)) {
    await tg()('sendMessage', { chat_id: chatId, text: part, link_preview_options: { is_disabled: true } });
  }
}

// ── Linking ────────────────────────────────────────────────────────────────
const linkKey = (code: string) => `tg:link:${createHash('sha256').update(code).digest('hex')}`;

export async function createLinkCode(userId: string) {
  const code = randomBytes(6).toString('base64url'); // 8 URL-safe characters
  await redis.set(linkKey(code), userId, 'EX', 900);
  return code;
}

export async function botUsername(): Promise<string | null> {
  if (!telegramEnabled()) return null;
  const cached = await redis.get('tg:me');
  if (cached) return cached;
  try {
    const me = await tg()('getMe');
    await redis.set('tg:me', me.username, 'EX', 86400);
    return me.username;
  } catch {
    return null;
  }
}

const HELP = [
  'Ask the Xanderia AI Council anything, in English or Bahasa Malaysia.',
  '',
  '• Just type a question: the council picks Quick or Council.',
  '• /quick <question> for a fast answer, /council <question> for the full council (1-3 minutes).',
  '• Follow-ups within 6 hours continue the same conversation; /new starts a fresh one.',
  voiceEnabled() ? '• Voice notes work too (transcribed on our own servers).' : '',
  '• /unlink disconnects this chat from your account.',
  '',
  'Do not send customer personal data (IC numbers, account numbers, phone numbers) through Telegram.',
]
  .filter((l, i, a) => l || a[i - 1])
  .join('\n');

// ── Incoming updates ───────────────────────────────────────────────────────
interface TgMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: { id: number; username?: string; first_name?: string };
  text?: string;
  voice?: { file_id: string; duration: number };
  audio?: { file_id: string; duration: number };
}

export async function handleUpdate(update: { update_id: number; message?: TgMessage }) {
  const msg = update.message;
  if (!msg || msg.chat.type !== 'private') return;
  const chatId = msg.chat.id;
  let text = (msg.text ?? '').trim();

  if (text.startsWith('/start')) {
    const code = text.split(/\s+/)[1];
    if (!code) return send(chatId, 'To connect, open the Council web app, click your name > Telegram, and use the link shown there.');
    const userId = await redis.get(linkKey(code));
    if (!userId) return send(chatId, 'That link has expired. Create a new one in the Council web app (your name > Telegram).');
    await redis.del(linkKey(code));
    await tx(async (c) => {
      await c.query('DELETE FROM telegram_links WHERE chat_id = $1 OR user_id = $2', [chatId, userId]);
      await c.query('INSERT INTO telegram_links (user_id, chat_id, username) VALUES ($1, $2, $3)', [userId, chatId, msg.from?.username ?? null]);
    });
    await writeAudit({ actorUserId: userId, action: 'telegram_linked', detail: { username: msg.from?.username ?? null } });
    const { rows } = await query('SELECT display_name FROM users WHERE id = $1', [userId]);
    return send(chatId, `Connected, ${rows[0]?.display_name ?? ''}.\n\n${HELP}`);
  }

  const { rows: linked } = await query(
    `SELECT u.id, u.role, u.department_id, u.display_name FROM telegram_links t JOIN users u ON u.id = t.user_id
      WHERE t.chat_id = $1 AND u.is_active`,
    [chatId],
  );
  const user = linked[0];
  if (!user) return send(chatId, 'This chat is not connected to a Council account. Open the Council web app, click your name > Telegram.');

  if (text === '/help') return send(chatId, HELP);
  if (text === '/new') {
    await redis.del(`tg:conv:${chatId}`);
    return send(chatId, 'OK, your next question starts a new conversation.');
  }
  if (text === '/unlink') {
    await query('DELETE FROM telegram_links WHERE chat_id = $1', [chatId]);
    await writeAudit({ actorUserId: user.id, action: 'telegram_unlinked', detail: {} });
    return send(chatId, 'Disconnected. You can reconnect from the Council web app at any time.');
  }

  // Voice notes → on-premises Whisper.
  const audio = msg.voice ?? msg.audio;
  if (audio) {
    if (!voiceEnabled()) return send(chatId, 'Voice notes are not enabled. Please type your question.');
    if (audio.duration > 300) return send(chatId, 'Please keep voice notes under 5 minutes.');
    const file = await tg()('getFile', { file_id: audio.file_id });
    const res = await fetch(`https://api.telegram.org/file/bot${config.TELEGRAM_BOT_TOKEN}/${file.file_path}`, { signal: AbortSignal.timeout(60_000) });
    text = await transcribe(Buffer.from(await res.arrayBuffer()), 'voice.ogg');
    if (!text) return send(chatId, 'Sorry, I could not make out that voice note. Please try again or type it.');
    await send(chatId, `🎙 "${text}"`);
  }
  if (!text) return;

  // Same per-user limit as the web app.
  const rl = `tg:rl:${user.id}`;
  const count = await redis.incr(rl);
  if (count === 1) await redis.expire(rl, 60);
  if (count > config.RATE_LIMIT_PER_MIN) return send(chatId, 'Too many questions in a minute. Please wait a moment.');

  let mode: 'auto' | 'quick' | 'council' = 'auto';
  const cmd = /^\/(quick|council)\b\s*/i.exec(text);
  if (cmd) {
    mode = cmd[1].toLowerCase() as 'quick' | 'council';
    text = text.slice(cmd[0].length).trim();
    if (!text) return send(chatId, `Type your question after /${mode}.`);
  }
  if (text.startsWith('/')) return send(chatId, HELP);
  if (mode === 'council' && !(await canUseCouncil(user.role))) return send(chatId, 'Council mode is not enabled for your role yet; asking for a quick answer instead.').then(() => ask(chatId, user, text, 'quick'));
  return ask(chatId, user, text.slice(0, 8000), mode);
}

async function ask(chatId: number, user: { id: string; department_id: string }, content: string, mode: 'auto' | 'quick' | 'council') {
  const convKey = `tg:conv:${chatId}`;
  const existing = await redis.get(convKey);
  const result = await tx(async (c) => {
    let conversationId = existing;
    if (conversationId) {
      const r = await c.query('SELECT id FROM conversations WHERE id = $1 AND user_id = $2', [conversationId, user.id]);
      if (!r.rows[0]) conversationId = null;
    }
    if (!conversationId) {
      const r = await c.query(`INSERT INTO conversations (user_id, department_id, title) VALUES ($1, $2, $3) RETURNING id`, [
        user.id,
        user.department_id,
        `[Telegram] ${content.replace(/\s+/g, ' ').slice(0, 60)}`,
      ]);
      conversationId = r.rows[0].id as string;
    }
    const userMsg = (
      await c.query(`INSERT INTO messages (conversation_id, role, content, department_id) VALUES ($1, 'user', $2, $3) RETURNING id`, [
        conversationId,
        content,
        user.department_id,
      ])
    ).rows[0];
    const assistant = (
      await c.query(
        `INSERT INTO messages (conversation_id, role, reply_to, requested_mode, department_id, status, options)
         VALUES ($1, 'assistant', $2, $3, $4, 'queued', $5) RETURNING id`,
        [conversationId, userMsg.id, mode, user.department_id, JSON.stringify({ channel: 'telegram' })],
      )
    ).rows[0];
    await c.query('UPDATE conversations SET updated_at = now() WHERE id = $1', [conversationId]);
    return { conversationId: conversationId!, userMessageId: userMsg.id as string, assistantId: assistant.id as string };
  });
  await redis.set(convKey, result.conversationId, 'EX', CONVERSATION_TTL);
  await writeAudit({
    actorUserId: user.id,
    action: 'question_asked',
    targetType: 'message',
    targetId: result.userMessageId,
    detail: {
      channel: 'telegram',
      conversation_id: result.conversationId,
      assistant_message_id: result.assistantId,
      requested_mode: mode,
      length: content.length,
      sha256: createHash('sha256').update(content).digest('hex'),
    },
  });
  await enqueueMessage(result.assistantId, mode);
  await tg()('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
  if (mode === 'council') await send(chatId, 'The council is meeting. This takes 1-3 minutes; I will send the verdict here.');
  return result;
}

/** Called by the pipeline when a Telegram question finishes (answer, clarifying questions or error). */
export async function deliverToTelegram(messageId: string) {
  if (!telegramEnabled()) return;
  const { rows } = await query(
    `SELECT m.status, m.mode, m.content, m.verdict, m.error, m.conversation_id, t.chat_id
       FROM messages m JOIN conversations c ON c.id = m.conversation_id
       JOIN telegram_links t ON t.user_id = c.user_id
      WHERE m.id = $1`,
    [messageId],
  );
  const m = rows[0];
  if (!m) return; // unlinked meanwhile
  const link = `${config.APP_BASE_URL.replace(/\/+$/, '')}/c/${m.conversation_id}`;
  let text: string;
  if (m.status === 'error') text = `Sorry, that did not work: ${m.error ?? 'unknown error'}\nPlease ask again.`;
  else if (m.mode === 'clarify') text = `${toPlainText(m.content)}\n\nReply here with your answers (or "skip").`;
  else if (m.verdict) text = `${toPlainText(verdictToMarkdown(m.verdict as Verdict))}\n\nFull report, action plan and PDF: ${link}`;
  else text = `${toPlainText(m.content ?? '')}\n\nOpen in the Council: ${link}`;
  await send(m.chat_id, text);
}

// ── Long polling (worker) ──────────────────────────────────────────────────
/** One poller across all workers (Redis lock); runs until the process exits. */
export async function startTelegramPolling(log: (s: string) => void = console.log) {
  if (!telegramEnabled()) return;
  const me = randomBytes(8).toString('hex');
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  log(`[telegram] bot @${(await botUsername()) ?? '?'} polling`);
  for (;;) {
    try {
      const got = await redis.set('tg:poller', me, 'EX', 90, 'NX');
      if (!got && (await redis.get('tg:poller')) !== me) {
        await sleep(30_000);
        continue;
      }
      await redis.expire('tg:poller', 90);
      const offset = Number((await redis.get('tg:offset')) ?? 0);
      const updates: Array<{ update_id: number; message?: TgMessage }> = await tg()('getUpdates', {
        offset,
        timeout: 50,
        allowed_updates: ['message'],
      });
      for (const u of updates) {
        await redis.set('tg:offset', u.update_id + 1);
        await handleUpdate(u).catch(async (err) => {
          console.error('[telegram] update failed:', err);
          if (u.message) await send(u.message.chat.id, 'Sorry, something went wrong. Please try again.').catch(() => {});
        });
      }
    } catch (err) {
      console.error('[telegram] polling error:', (err as Error).message);
      await sleep(10_000);
    }
  }
}
