import type { FastifyInstance } from 'fastify';
import { writeAudit } from '../audit.js';
import { query } from '../db/pool.js';
import { botUsername, createLinkCode, telegramEnabled } from '../telegram/bot.js';
import { transcribe, voiceEnabled } from '../voice/transcribe.js';

/** Other ways in: Telegram linking and voice questions. */
export default async function channelRoutes(app: FastifyInstance) {
  const auth = { preHandler: app.authenticate };

  app.get('/api/channels', auth, async (req) => {
    const { rows } = await query('SELECT username, linked_at FROM telegram_links WHERE user_id = $1', [req.user.id]);
    return {
      voice: voiceEnabled(),
      telegram: telegramEnabled() ? { bot: await botUsername(), linked: rows[0] ?? null } : null,
    };
  });

  /** One-time deep link (15 minutes) that connects the user's Telegram chat to their account. */
  app.post('/api/telegram/link', auth, async (req, reply) => {
    if (!telegramEnabled()) return reply.code(404).send({ error: 'Telegram is not enabled on this server' });
    const bot = await botUsername();
    if (!bot) return reply.code(502).send({ error: 'Could not reach Telegram. Check TELEGRAM_BOT_TOKEN and outbound internet access.' });
    const code = await createLinkCode(req.user.id);
    return { url: `https://t.me/${bot}?start=${code}`, bot, expiresInMinutes: 15 };
  });

  app.delete('/api/telegram/link', auth, async (req) => {
    const { rowCount } = await query('DELETE FROM telegram_links WHERE user_id = $1', [req.user.id]);
    if (rowCount) await writeAudit({ actorUserId: req.user.id, action: 'telegram_unlinked', detail: {} });
    return { ok: true };
  });

  /** Voice question → text (on-premises Whisper). The audio is not stored. */
  app.post(
    '/api/voice/transcribe',
    { ...auth, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      if (!voiceEnabled()) return reply.code(404).send({ error: 'Voice input is not enabled on this server' });
      const file = await req.file({ limits: { fileSize: 15 * 1024 * 1024 } });
      if (!file) return reply.code(400).send({ error: 'No audio uploaded' });
      const audio = await file.toBuffer();
      if (file.file.truncated) return reply.code(413).send({ error: 'Recording too long' });
      const lang = (file.fields.language as { value?: string } | undefined)?.value;
      try {
        const text = await transcribe(audio, file.filename || 'voice.webm', { language: lang === 'ms' || lang === 'en' ? lang : undefined });
        await writeAudit({ actorUserId: req.user.id, action: 'voice_transcribed', detail: { bytes: audio.length, chars: text.length } });
        return { text };
      } catch (err) {
        return reply.code(502).send({ error: (err as Error).message });
      }
    },
  );
}
