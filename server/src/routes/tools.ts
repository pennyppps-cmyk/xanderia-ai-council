import type { FastifyInstance } from 'fastify';
import { writeAudit } from '../audit.js';
import { analyseArrears, arrearsMarkdown, readTable } from '../tools/arrears.js';

/** Working tools next to the chat (the calculators are client-side; file analysis runs here). */
export default async function toolRoutes(app: FastifyInstance) {
  const auth = { preHandler: app.authenticate };

  /** Arrears file → bucket / branch / product aggregates. The file is not stored. */
  app.post('/api/tools/arrears', auth, async (req, reply) => {
    const file = await req.file({ limits: { fileSize: 25 * 1024 * 1024 } });
    if (!file) return reply.code(400).send({ error: 'No file uploaded' });
    const data = await file.toBuffer();
    if (file.file.truncated) return reply.code(413).send({ error: 'The file is larger than 25 MB' });
    try {
      const { headers, rows } = await readTable(file.filename, data);
      const summary = analyseArrears(headers, rows);
      await writeAudit({
        actorUserId: req.user.id,
        action: 'arrears_analysed',
        detail: { file: file.filename, rows: summary.rows, skipped: summary.skipped, columns: summary.columns },
      });
      return { ...summary, headers, markdown: arrearsMarkdown(summary) };
    } catch (err) {
      return reply.code(422).send({ error: (err as Error).message });
    }
  });
}
