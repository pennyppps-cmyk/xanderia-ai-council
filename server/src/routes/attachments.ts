import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { writeAudit } from '../audit.js';
import { query } from '../db/pool.js';
import { extractDocumentText, SUPPORTED } from '../rag/extract.js';

/**
 * Attach a document to a question (a plan, proposal or spreadsheet for the council to judge).
 * The file is read in memory and only its text is kept; it is linked to the question when sent.
 */
export default async function attachmentRoutes(app: FastifyInstance) {
  const auth = { preHandler: app.authenticate };

  app.post('/api/attachments', { ...auth, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const file = await req.file({ limits: { fileSize: 10 * 1024 * 1024 } });
    if (!file) return reply.code(400).send({ error: 'No file uploaded' });
    const data = await file.toBuffer();
    if (file.file.truncated) return reply.code(413).send({ error: 'The file is larger than 10 MB' });
    if (!SUPPORTED.test(file.filename)) {
      return reply.code(415).send({ error: 'Attach a PDF, Word (.docx), Excel (.xlsx), .txt, .md or .csv file.' });
    }
    let text: string;
    try {
      text = (await extractDocumentText(file.filename, data)).trim();
    } catch (err) {
      return reply.code(422).send({ error: (err as Error).message });
    }
    if (text.length < 20) return reply.code(422).send({ error: 'No readable text was found in this file.' });
    const sha256 = createHash('sha256').update(data).digest('hex');
    const { rows } = await query(
      `INSERT INTO attachments (user_id, filename, bytes, chars, sha256, text) VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, filename, chars`,
      [req.user.id, file.filename.slice(0, 200), data.length, text.length, sha256, text],
    );
    await writeAudit({
      actorUserId: req.user.id,
      action: 'attachment_uploaded',
      targetType: 'attachment',
      targetId: rows[0].id,
      detail: { filename: file.filename, bytes: data.length, chars: text.length, sha256 },
    });
    return rows[0];
  });

  /** Remove an attachment before the question is sent. */
  app.delete('/api/attachments/:id', auth, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await query(`DELETE FROM attachments WHERE id = $1 AND user_id = $2 AND message_id IS NULL`, [id, req.user.id]);
    return { ok: true };
  });
}
