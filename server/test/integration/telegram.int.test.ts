/**
 *   TEST_DATABASE_URL=postgres://council:council@localhost:5433/council_tg_test TEST_REDIS_URL=redis://localhost:6380 npm test
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;

describe.skipIf(!url || !redisUrl)('telegram bot (integration, fake Telegram API)', () => {
  let bot: typeof import('../../src/telegram/bot.js');
  let db: pg.Pool;
  const sent: Array<{ method: string; params: any }> = [];
  const texts = () => sent.filter((s) => s.method === 'sendMessage').map((s) => s.params.text as string);
  let userId = '';
  const CHAT = 424242;
  const update = (text: string) => ({ update_id: 1, message: { message_id: 1, chat: { id: CHAT, type: 'private' }, from: { id: 1, username: 'aisyah' }, text } });

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: url!.replace(/\/[^/]+$/, '/postgres') });
    await admin.connect();
    const name = new URL(url!).pathname.slice(1);
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${name}`);
    await admin.end();
    process.env.DATABASE_URL = url;
    process.env.REDIS_URL = redisUrl;
    process.env.TELEGRAM_BOT_TOKEN = '123:test';
    await (await import('../../src/db/migrate.js')).migrate(url!, () => {});
    await (await import('../../src/db/seed.js')).seed(() => {});
    bot = await import('../../src/telegram/bot.js');
    bot.setTelegramApi(async (method, params) => {
      sent.push({ method, params });
      return method === 'getMe' ? { username: 'XanderiaCouncilBot' } : true;
    });
    db = new pg.Pool({ connectionString: url });
    userId = (await db.query(`SELECT id FROM users LIMIT 1`)).rows[0].id;
  });

  afterAll(async () => {
    await (await import('../../src/queue/queue.js')).getQueue().obliterate({ force: true }).catch(() => {});
    await db?.end();
    await (await import('../../src/db/pool.js')).pool.end();
    (await import('../../src/redis.js')).redis.disconnect();
  });

  it('refuses unlinked chats', async () => {
    await bot.handleUpdate(update('hello'));
    expect(texts().at(-1)).toMatch(/not connected/);
  });

  it('links a chat with a one-time code', async () => {
    const code = await bot.createLinkCode(userId);
    await bot.handleUpdate(update(`/start ${code}`));
    expect(texts().at(-1)).toMatch(/^Connected/);
    const link = await db.query(`SELECT chat_id::text, username FROM telegram_links WHERE user_id = $1`, [userId]);
    expect(link.rows[0]).toEqual({ chat_id: String(CHAT), username: 'aisyah' });
    // The code is single-use.
    await bot.handleUpdate(update(`/start ${code}`));
    expect(texts().at(-1)).toMatch(/expired/);
  });

  it('turns a message into a queued council question and continues the conversation', async () => {
    await bot.handleUpdate(update('/council Should we pilot WhatsApp reminders?'));
    expect(texts().at(-1)).toMatch(/council is meeting/);
    const m = await db.query(
      `SELECT a.requested_mode, a.options, u.content, c.title, c.id AS conv FROM messages a JOIN messages u ON u.id = a.reply_to
         JOIN conversations c ON c.id = a.conversation_id WHERE a.role = 'assistant' ORDER BY a.created_at DESC LIMIT 1`,
    );
    expect(m.rows[0]).toMatchObject({ requested_mode: 'council', options: { channel: 'telegram' }, content: 'Should we pilot WhatsApp reminders?' });
    expect(m.rows[0].title).toMatch(/^\[Telegram\]/);
    await bot.handleUpdate(update('And for 90+ days?'));
    const n = await db.query(`SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1 AND role = 'user'`, [m.rows[0].conv]);
    expect(n.rows[0].n).toBe(2);
    const audit = await db.query(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'question_asked' AND detail->>'channel' = 'telegram'`);
    expect(audit.rows[0].n).toBe(2);
  });

  it('delivers the finished verdict back to the chat with a link', async () => {
    const { rows } = await db.query(`SELECT id FROM messages WHERE role = 'assistant' ORDER BY created_at LIMIT 1`);
    await db.query(
      `UPDATE messages SET status = 'done', mode = 'council', verdict = $2 WHERE id = $1`,
      [rows[0].id, JSON.stringify({ verdict: 'Pilot it in two branches first.', why: 'Low cost, measurable.', conflicts: [], action_plan: [], risks: [], open_questions: [], confidence: { level: 'medium', what_would_change: '' } })],
    );
    sent.length = 0;
    await bot.deliverToTelegram(rows[0].id);
    expect(sent[0].params.chat_id).toBe(String(CHAT));
    expect(texts()[0]).toContain('Pilot it in two branches first.');
    expect(texts()[0]).toMatch(/\/c\/[0-9a-f-]{36}/);
  });

  it('unlinks on /unlink', async () => {
    await bot.handleUpdate(update('/unlink'));
    expect((await db.query(`SELECT 1 FROM telegram_links`)).rowCount).toBe(0);
  });
});
