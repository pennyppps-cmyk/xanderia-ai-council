import type { MultipartFile } from '@fastify/multipart';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { writeAudit } from '../audit.js';
import { query } from '../db/pool.js';
import { countTbc } from '../documents/content.js';
import { DEFAULT_FOOTER, DEFAULT_OUTLINES, DOC_TYPES, DocOutlines, readOutlines } from '../documents/outlines.js';
import { checkLetterhead, renderDocument } from '../documents/render.js';
import {
  approveDocument,
  auditDoc,
  canApprove,
  canDownload,
  canView,
  createDocument,
  loadDocument,
  loadLetterhead,
  renderDocx,
  type DocRow,
} from '../documents/service.js';
import { enqueueDocumentWrite, enqueueSectionRewrite } from '../queue/docQueue.js';
import { getSetting, setSetting } from '../settings.js';

/**
 * Official documents drafted from a council verdict: executive briefs and board papers on the
 * company letterhead. Drafts are edited here; approval locks them and issues the reference number.
 */
const Uuid = z.object({ id: z.string().uuid() });
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

async function reviewBeforeActing(departmentId: string | null) {
  if (!departmentId) return false;
  const { rows } = await query(`SELECT review_before_acting FROM departments WHERE id = $1`, [departmentId]);
  return !!rows[0]?.review_before_acting;
}

/** The document, if this user may see it; replies 404 otherwise (so ids cannot be probed). */
async function visibleDoc(req: FastifyRequest, reply: FastifyReply): Promise<DocRow | null> {
  const { id } = Uuid.parse(req.params);
  const doc = await loadDocument(id);
  if (!doc || !canView(doc, req.user)) {
    reply.code(404).send({ error: 'Document not found' });
    return null;
  }
  return doc;
}

/** Author, department leads and admins may edit a draft. */
function canEdit(doc: DocRow, req: FastifyRequest) {
  return doc.status === 'draft' && (doc.created_by === req.user.id || canApprove(doc, req.user, true));
}

function fileName(doc: DocRow) {
  const base = (doc.ref_no ? `${doc.ref_no.replace(/\//g, '-')} ` : 'DRAFT ') + doc.subject;
  return base.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 90) || 'document';
}

export default async function documentRoutes(app: FastifyInstance) {
  const auth = { preHandler: app.authenticate };
  const admin = { preHandler: app.requireRole('admin') };

  app.post('/api/messages/:id/documents', auth, async (req, reply) => {
    const { id } = Uuid.parse(req.params);
    const body = z
      .object({
        type: z.enum(DOC_TYPES),
        language: z.enum(['en', 'ms']),
        subject: z.string().trim().max(200).optional(),
        addressedTo: z.string().trim().max(200).default(''),
      })
      .parse(req.body);
    const { rows } = await query(
      `SELECT m.id, m.department_id, c.title FROM messages m JOIN conversations c ON c.id = m.conversation_id
        WHERE m.id = $1 AND c.user_id = $2 AND m.mode = 'council' AND m.status = 'done' AND m.verdict IS NOT NULL`,
      [id, req.user.id],
    );
    const m = rows[0];
    if (!m) return reply.code(404).send({ error: 'Documents can be drafted from your own finished council verdicts' });
    const docId = await createDocument({
      messageId: id,
      userId: req.user.id,
      departmentId: m.department_id ?? req.user.department_id,
      type: body.type,
      language: body.language,
      subject: body.subject || m.title,
      addressedTo: body.addressedTo,
    });
    await enqueueDocumentWrite(docId);
    await auditDoc(req.user.id, 'document_created', docId, { message_id: id, type: body.type, language: body.language });
    return { id: docId };
  });

  app.get('/api/documents', auth, async (req) => {
    const { rows } = await query(
      `SELECT d.id, d.doc_type, d.language, d.subject, d.status, d.ref_no, d.created_at, d.updated_at, d.approved_at,
              u.display_name AS author, dep.name AS department
         FROM official_documents d
         LEFT JOIN users u ON u.id = d.created_by
         LEFT JOIN departments dep ON dep.id = d.department_id
        WHERE d.created_by = $1 OR $2 = 'admin' OR ($2 = 'dept_lead' AND d.department_id = $3)
        ORDER BY d.updated_at DESC LIMIT 200`,
      [req.user.id, req.user.role, req.user.department_id],
    );
    return rows;
  });

  app.get('/api/documents/:id', auth, async (req, reply) => {
    const doc = await visibleDoc(req, reply);
    if (!doc) return;
    const review = await reviewBeforeActing(doc.department_id);
    const { rows } = await query(
      `SELECT (SELECT display_name FROM users WHERE id = $1) AS author, (SELECT display_name FROM users WHERE id = $2) AS approver,
              (SELECT name FROM departments WHERE id = $3) AS department,
              (SELECT conversation_id FROM messages WHERE id = $4) AS conversation_id`,
      [doc.created_by, doc.approved_by, doc.department_id, doc.message_id],
    );
    const outline = readOutlines(await getSetting('document_outlines', DEFAULT_OUTLINES))[doc.doc_type];
    return {
      ...doc,
      ...rows[0],
      type_name: outline.name,
      title: outline[doc.language].title,
      review_before_acting: review,
      tbc: countTbc(doc.sections.map((s) => s.content)),
      can: {
        edit: canEdit(doc, req),
        approve: doc.status === 'draft' && canApprove(doc, req.user, review),
        download: canDownload(doc, review),
        delete: req.user.role === 'admin' || (doc.created_by === req.user.id && doc.status !== 'approved'),
        retry: doc.status === 'error' && doc.created_by === req.user.id,
      },
    };
  });

  app.patch('/api/documents/:id', auth, async (req, reply) => {
    const doc = await visibleDoc(req, reply);
    if (!doc) return;
    if (!canEdit(doc, req)) return reply.code(409).send({ error: 'Only a draft can be changed' });
    const body = z.object({ subject: z.string().trim().min(3).max(200).optional(), addressedTo: z.string().trim().max(200).optional() }).parse(req.body);
    await query(
      `UPDATE official_documents SET subject = COALESCE($2, subject), addressed_to = COALESCE($3, addressed_to), updated_at = now() WHERE id = $1`,
      [doc.id, body.subject ?? null, body.addressedTo ?? null],
    );
    return { ok: true };
  });

  app.put('/api/documents/:id/sections/:key', auth, async (req, reply) => {
    const doc = await visibleDoc(req, reply);
    if (!doc) return;
    const { key } = z.object({ key: z.string().max(40) }).parse(req.params);
    const { content } = z.object({ content: z.string().max(20_000) }).parse(req.body);
    if (!canEdit(doc, req)) return reply.code(409).send({ error: 'Only a draft can be changed' });
    const s = doc.sections.find((x) => x.key === key);
    if (!s) return reply.code(404).send({ error: 'No such section' });
    if (s.status === 'writing') return reply.code(409).send({ error: 'This section is being rewritten' });
    s.content = content.trim();
    await query(`UPDATE official_documents SET sections = $2, updated_at = now() WHERE id = $1`, [doc.id, JSON.stringify(doc.sections)]);
    await auditDoc(req.user.id, 'document_edited', doc.id, { section: key });
    return { ok: true };
  });

  app.post('/api/documents/:id/sections/:key/rewrite', auth, async (req, reply) => {
    const doc = await visibleDoc(req, reply);
    if (!doc) return;
    const { key } = z.object({ key: z.string().max(40) }).parse(req.params);
    const { instruction } = z.object({ instruction: z.string().trim().min(2).max(500) }).parse(req.body);
    if (!canEdit(doc, req)) return reply.code(409).send({ error: 'Only a draft can be changed' });
    const s = doc.sections.find((x) => x.key === key);
    if (!s) return reply.code(404).send({ error: 'No such section' });
    if (s.kind !== 'write') return reply.code(400).send({ error: 'This section is built from the verdict; edit it directly' });
    if (s.status === 'writing') return reply.code(409).send({ error: 'This section is already being rewritten' });
    await enqueueSectionRewrite(doc.id, key, instruction);
    await auditDoc(req.user.id, 'document_section_rewrite', doc.id, { section: key });
    return { ok: true };
  });

  app.post('/api/documents/:id/retry', auth, async (req, reply) => {
    const doc = await visibleDoc(req, reply);
    if (!doc) return;
    if (doc.status !== 'error' || doc.created_by !== req.user.id) return reply.code(409).send({ error: 'Nothing to retry' });
    await query(`UPDATE official_documents SET status = 'queued', error = NULL, updated_at = now() WHERE id = $1`, [doc.id]);
    await enqueueDocumentWrite(doc.id);
    return { ok: true };
  });

  app.post('/api/documents/:id/approve', auth, async (req, reply) => {
    const doc = await visibleDoc(req, reply);
    if (!doc) return;
    if (!canApprove(doc, req.user, await reviewBeforeActing(doc.department_id))) {
      return reply.code(403).send({ error: 'Only the department lead or an admin can approve documents for this department' });
    }
    if (doc.sections.some((s) => s.status !== 'done')) return reply.code(409).send({ error: 'Wait until every section is written' });
    const ref = await approveDocument(doc.id, req.user.id);
    await auditDoc(req.user.id, 'document_approved', doc.id, { ref_no: ref, open_tbc: countTbc(doc.sections.map((s) => s.content)) });
    return { ref_no: ref };
  });

  app.delete('/api/documents/:id', auth, async (req, reply) => {
    const doc = await visibleDoc(req, reply);
    if (!doc) return;
    const allowed = req.user.role === 'admin' || (doc.created_by === req.user.id && doc.status !== 'approved');
    if (!allowed) return reply.code(403).send({ error: 'Approved documents can only be deleted by an admin' });
    await query(`DELETE FROM official_documents WHERE id = $1`, [doc.id]);
    await auditDoc(req.user.id, 'document_deleted', doc.id, { subject: doc.subject, ref_no: doc.ref_no });
    return { ok: true };
  });

  app.get('/api/documents/:id/document.docx', auth, async (req, reply) => {
    const doc = await visibleDoc(req, reply);
    if (!doc) return;
    if (!canDownload(doc, await reviewBeforeActing(doc.department_id))) {
      return reply.code(403).send({ error: doc.status === 'draft' ? 'This department requires approval before the document can be downloaded' : 'The document is not finished yet' });
    }
    const buf = await renderDocx(doc);
    await auditDoc(req.user.id, 'document_downloaded', doc.id, { ref_no: doc.ref_no, bytes: buf.length });
    return reply
      .header('content-type', DOCX_TYPE)
      .header('content-disposition', `attachment; filename="${fileName(doc)}.docx"`)
      .header('cache-control', 'private, no-store')
      .send(buf);
  });

  // ── Admin: letterhead, footer, outlines ──

  app.get('/api/admin/documents/settings', admin, async () => {
    const { rows } = await query(`SELECT file_name, uploaded_at FROM document_letterhead WHERE id = 1`);
    return {
      letterhead: rows[0] ? { fileName: rows[0].file_name, uploadedAt: rows[0].uploaded_at, custom: true } : { fileName: 'Letterhead (shipped)', custom: false },
      footer: { ...DEFAULT_FOOTER, ...(await getSetting<Record<string, string>>('document_footer', DEFAULT_FOOTER)) },
      outlines: readOutlines(await getSetting('document_outlines', DEFAULT_OUTLINES)),
    };
  });

  app.put('/api/admin/documents/settings', admin, async (req) => {
    const body = z
      .object({
        footer: z.object({ en: z.string().trim().min(1).max(400), ms: z.string().trim().min(1).max(400) }).optional(),
        outlines: DocOutlines.optional(),
      })
      .parse(req.body);
    if (body.footer) await setSetting('document_footer', body.footer);
    if (body.outlines) await setSetting('document_outlines', body.outlines);
    await writeAudit({ actorUserId: req.user.id, action: 'document_settings_updated', detail: { footer: !!body.footer, outlines: !!body.outlines } });
    return { ok: true };
  });

  app.post('/api/admin/documents/letterhead', admin, async (req, reply) => {
    let file: { filename: string; data: Buffer } | null = null;
    for await (const part of req.parts({ limits: { fileSize: 5 * 1024 * 1024 } })) {
      if (part.type !== 'file') continue;
      const f = part as MultipartFile;
      const data = await f.toBuffer();
      if (f.file.truncated) return reply.code(413).send({ error: 'The letterhead must be smaller than 5 MB' });
      file = { filename: f.filename, data };
    }
    if (!file) return reply.code(400).send({ error: 'Choose a .docx file' });
    try {
      checkLetterhead(file.data);
      renderDocument(file.data, sampleInput());
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
    await query(
      `INSERT INTO document_letterhead (id, file_name, docx, uploaded_by) VALUES (1, $1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET file_name = EXCLUDED.file_name, docx = EXCLUDED.docx, uploaded_by = EXCLUDED.uploaded_by, uploaded_at = now()`,
      [file.filename.slice(0, 200), file.data, req.user.id],
    );
    await writeAudit({ actorUserId: req.user.id, action: 'letterhead_uploaded', detail: { file: file.filename, bytes: file.data.length } });
    return { ok: true };
  });

  app.delete('/api/admin/documents/letterhead', admin, async (req) => {
    await query(`DELETE FROM document_letterhead WHERE id = 1`);
    await writeAudit({ actorUserId: req.user.id, action: 'letterhead_reset', detail: {} });
    return { ok: true };
  });

  /** A sample page on the current letterhead, to check the layout after an upload. */
  app.get('/api/admin/documents/sample.docx', admin, async (_req, reply) => {
    const { docx } = await loadLetterhead();
    const footer = await getSetting<Record<string, string>>('document_footer', DEFAULT_FOOTER);
    const buf = renderDocument(docx, { ...sampleInput(), footer: footer?.en || DEFAULT_FOOTER.en });
    return reply.header('content-type', DOCX_TYPE).header('content-disposition', 'attachment; filename="Letterhead-sample.docx"').send(buf);
  });
}

function sampleInput() {
  return {
    title: 'EXECUTIVE BRIEF',
    meta: [
      ['To', 'Management Committee'],
      ['From', 'Administrator'],
      ['Date', '1 January 2026'],
      ['Ref', 'XB/EXEC/2026/000'],
      ['Subject', '**Sample document**'],
    ] as Array<[string, string]>,
    numbered: false,
    sections: [
      { heading: 'Purpose', content: 'This sample shows how documents look on the letterhead. Missing facts appear like this: [TBC: an example].' },
      { heading: 'Key Reasons', content: '- The header and logo come from the letterhead file.\n- The page is A4.\n- The footer carries the ownership notice and page numbers.' },
      { heading: 'Risks and Mitigations', content: '| No. | Risk | Likelihood | Impact | Mitigation |\n|---|---|---|---|---|\n| 1 | Example risk | Low | Medium | Example mitigation |' },
    ],
    footer: DEFAULT_FOOTER.en,
    pageLabel: { page: 'Page', of: 'of' },
  };
}
