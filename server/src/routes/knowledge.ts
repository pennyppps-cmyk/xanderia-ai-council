import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { writeAudit } from '../audit.js';
import { query } from '../db/pool.js';
import { STALE_SQL } from '../jobs.js';
import { embed } from '../llm/registry.js';
import { extractDocumentText, SUPPORTED } from '../rag/extract.js';
import { ingestDocument } from '../rag/ingest.js';

/** dept_leads manage their own department's library; admins manage all, including company-wide. */
function canManage(req: FastifyRequest, departmentId: string | null, companyWide: boolean) {
  if (req.user.role === 'admin') return true;
  return req.user.role === 'dept_lead' && !companyWide && departmentId === req.user.department_id;
}

export default async function knowledgeRoutes(app: FastifyInstance) {
  const lead = { preHandler: app.requireRole('dept_lead') };

  app.get('/api/knowledge/documents', lead, async (req) => {
    const { rows } = await query(
      `SELECT d.id, d.title, d.source_filename, d.company_wide, d.department_id, dep.name AS department_name,
              d.chunk_count, d.created_at, u.display_name AS uploaded_by,
              d.review_after_days, d.reviewed_at, r.display_name AS reviewed_by, ${STALE_SQL} AS stale,
              (COALESCE(d.reviewed_at, d.created_at) + make_interval(days => d.review_after_days))::date AS review_due
         FROM documents d
         LEFT JOIN departments dep ON dep.id = d.department_id
         LEFT JOIN users u ON u.id = d.uploaded_by
         LEFT JOIN users r ON r.id = d.reviewed_by
        WHERE $1 OR d.department_id = $2
        ORDER BY d.created_at DESC`,
      [req.user.role === 'admin', req.user.department_id],
    );
    return rows;
  });

  app.post('/api/knowledge/documents', lead, async (req: FastifyRequest, reply: FastifyReply) => {
    const file = await req.file({ limits: { fileSize: 10 * 1024 * 1024 } });
    if (!file) return reply.code(400).send({ error: 'No file uploaded' });
    const fields = Object.fromEntries(
      Object.entries(file.fields).map(([k, v]: [string, any]) => [k, v?.value]),
    );
    const meta = z
      .object({
        title: z.string().trim().min(1).optional(),
        departmentId: z.string().uuid().optional().or(z.literal('')),
        companyWide: z.enum(['true', 'false']).default('false'),
      })
      .parse(fields);
    const companyWide = meta.companyWide === 'true';
    const departmentId = meta.departmentId || (companyWide ? null : req.user.department_id);
    if (!canManage(req, departmentId, companyWide)) return reply.code(403).send({ error: 'Forbidden' });

    if (!SUPPORTED.test(file.filename)) {
      await file.toBuffer(); // drain
      return reply.code(415).send({ error: 'Supported files: PDF, Word (.docx), Excel (.xlsx), .txt, .md and .csv.' });
    }
    const title = meta.title ?? file.filename.replace(/\.[^.]+$/, '');
    try {
      const text = await extractDocumentText(file.filename, await file.toBuffer());
      const result = await ingestDocument(
        { title, text, departmentId, companyWide, sourceFilename: file.filename, uploadedBy: req.user.id },
        (texts) => embed(texts, { userId: req.user.id, purpose: 'ingest' }),
      );
      await writeAudit({
        actorUserId: req.user.id,
        action: 'document_uploaded',
        targetType: 'document',
        targetId: result.documentId,
        detail: { title, department_id: departmentId, company_wide: companyWide, chunks: result.chunks },
      });
      return result;
    } catch (err) {
      return reply.code(502).send({ error: `Could not index document: ${(err as Error).message}` });
    }
  });

  /** Knowledge freshness: confirm a document is still current, and/or change its review interval. */
  app.post('/api/knowledge/documents/:id/review', lead, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ reviewAfterDays: z.number().int().min(7).max(1095).optional() }).parse(req.body ?? {});
    const { rows } = await query('SELECT department_id, company_wide, title FROM documents WHERE id = $1', [id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Not found' });
    if (!canManage(req, rows[0].department_id, rows[0].company_wide)) return reply.code(403).send({ error: 'Forbidden' });
    await query(
      `UPDATE documents SET reviewed_at = now(), reviewed_by = $2, stale_notified_at = NULL,
              review_after_days = COALESCE($3, review_after_days) WHERE id = $1`,
      [id, req.user.id, body.reviewAfterDays ?? null],
    );
    await writeAudit({ actorUserId: req.user.id, action: 'document_reviewed', targetType: 'document', targetId: id, detail: { title: rows[0].title, ...body } });
    return { ok: true };
  });

  app.delete('/api/knowledge/documents/:id', lead, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { rows } = await query('SELECT department_id, company_wide, title FROM documents WHERE id = $1', [id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Not found' });
    if (!canManage(req, rows[0].department_id, rows[0].company_wide)) return reply.code(403).send({ error: 'Forbidden' });
    await query('DELETE FROM documents WHERE id = $1', [id]);
    await writeAudit({ actorUserId: req.user.id, action: 'document_deleted', targetType: 'document', targetId: id, detail: { title: rows[0].title } });
    return { ok: true };
  });
}
