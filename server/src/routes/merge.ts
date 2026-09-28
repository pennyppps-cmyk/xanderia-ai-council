import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { z } from 'zod';
import { writeAudit } from '../audit.js';
import { query, tx } from '../db/pool.js';
import { PRIORITY } from '../llm/gate.js';
import { gateway } from '../llm/registry.js';
import { extractTags, insertTag, previewHtml, renderDocx } from '../merge/docx.js';
import { autoMap, cleanEmailValue, fillText, FORMATS, OPS, passes, readData, safeFileName, SheetChoice, valuesFor, type EmailSettings, type Filter, type Mapping, type Row } from '../merge/mapping.js';
import { docxToPdf, pdfAvailable } from '../merge/pdf.js';
import { zip } from '../notis/letter.js';
import { notisSender } from '../notis/send.js';

/**
 * Templates workspace: Word templates with {{tags}}, mapped once to the columns of an uploaded
 * spreadsheet; every row becomes a document (Word, or PDF when a converter is set up), an Outlook
 * draft, or an email from the customer mailbox.
 */
const MAX = 25 * 1024 * 1024;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const csv = (rows: Array<Array<string | number | null>>) =>
  '﻿' + rows.map((r) => r.map((v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\r\n');
const today = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

const MappingZ = z.record(
  z.string().max(80),
  z.object({
    source: z.enum(['column', 'text', 'run_date']),
    column: z.string().max(200).optional(),
    text: z.string().max(2000).optional(),
    format: z.enum(Object.keys(FORMATS) as [keyof typeof FORMATS, ...Array<keyof typeof FORMATS>]).optional(),
  }),
);
const FiltersZ = z.array(z.object({ column: z.string().max(200), op: z.enum(Object.keys(OPS) as [keyof typeof OPS, ...Array<keyof typeof OPS>]), value: z.string().max(200).optional() })).max(10);
const EmailZ = z.object({ toColumn: z.string().max(200).optional(), subject: z.string().max(300).optional(), body: z.string().max(10000).optional() });

interface Template {
  id: string;
  name: string;
  description: string;
  file_name: string;
  docx: Buffer;
  tags: string[];
  mapping: Mapping;
  filters: Filter[];
  email: EmailSettings;
  filename_pattern: string;
  sheet: string | null;
  department_id: string | null;
  shared: boolean;
  created_by: string | null;
}

async function readUpload(req: FastifyRequest) {
  let file: { filename: string; data: Buffer } | null = null;
  const fields: Record<string, string> = {};
  for await (const part of req.parts({ limits: { fileSize: MAX } })) {
    if (part.type === 'file') {
      const f = part as MultipartFile;
      const data = await f.toBuffer();
      if (f.file.truncated) throw Object.assign(new Error('The file is larger than 25 MB'), { statusCode: 413 });
      file = { filename: f.filename, data };
    } else fields[part.fieldname] = String((part as { value: unknown }).value ?? '');
  }
  return { file, fields };
}

export default async function mergeRoutes(app: FastifyInstance) {
  const auth = { preHandler: app.authenticate };
  const idParam = (req: FastifyRequest) => z.object({ id: z.string().uuid() }).parse(req.params).id;

  const canSee = (req: FastifyRequest, t: Pick<Template, 'shared' | 'department_id' | 'created_by'>) =>
    req.user.role === 'admin' || t.shared || t.department_id === req.user.department_id || t.created_by === req.user.id;
  const canEdit = (req: FastifyRequest, t: Pick<Template, 'department_id' | 'created_by'>) =>
    req.user.role === 'admin' || t.created_by === req.user.id || (req.user.role === 'dept_lead' && t.department_id === req.user.department_id);

  async function loadTemplate(req: FastifyRequest, reply: FastifyReply, id: string, withFile = false): Promise<Template | null> {
    const { rows } = await query(`SELECT ${withFile ? '*' : 'id, name, description, file_name, tags, mapping, filters, email, filename_pattern, sheet, department_id, shared, created_by'} FROM merge_templates WHERE id = $1`, [id]);
    const t = rows[0] as Template | undefined;
    if (!t || !canSee(req, t)) {
      reply.code(404).send({ error: 'Template not found' });
      return null;
    }
    return t;
  }

  async function loadRun(req: FastifyRequest, reply: FastifyReply, id: string) {
    const { rows } = await query(
      `SELECT r.id, r.template_id, r.source_file, r.sheet, r.headers, to_char(r.run_date, 'YYYY-MM-DD') AS run_date, r.created_at, r.purged_at, r.created_by
         FROM merge_runs r WHERE r.id = $1`,
      [id],
    );
    const run = rows[0];
    if (!run) {
      reply.code(404).send({ error: 'Not found' });
      return null;
    }
    const t = await loadTemplate(req, reply, run.template_id, true);
    if (!t) return null;
    return { run, t };
  }

  // ── Templates ──────────────────────────────────────────────────────────────
  app.get('/api/merge/meta', auth, async () => ({ formats: FORMATS, ops: OPS, pdf: pdfAvailable(), directSending: !!notisSender() }));

  app.get('/api/merge/templates', auth, async (req) => {
    const { rows } = await query(
      `SELECT t.id, t.name, t.description, t.file_name, t.tags, t.shared, t.updated_at, t.department_id, t.created_by,
              d.name AS department, u.display_name AS owner,
              (SELECT max(created_at) FROM merge_runs r WHERE r.template_id = t.id) AS last_run
         FROM merge_templates t LEFT JOIN departments d ON d.id = t.department_id LEFT JOIN users u ON u.id = t.created_by
        ORDER BY t.updated_at DESC`,
    );
    return rows.filter((t) => canSee(req, t)).map(({ department_id: _d, created_by: _c, ...t }) => t);
  });

  app.post('/api/merge/templates', auth, async (req, reply) => {
    const { file, fields } = await readUpload(req);
    if (!file || !/\.docx$/i.test(file.filename)) return reply.code(400).send({ error: 'Upload the template as a Word document (.docx) with {{tags}} where the data goes' });
    let tags: string[];
    try {
      tags = extractTags(file.data);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
    const name = (fields.name || file.filename.replace(/\.docx$/i, '')).trim().slice(0, 120);
    const { rows } = await query(
      `INSERT INTO merge_templates (name, file_name, docx, tags, filename_pattern, department_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [name, file.filename.slice(0, 200), file.data, tags, `${safeFileName(name)}_{{row}}`, req.user.department_id, req.user.id],
    );
    await writeAudit({ actorUserId: req.user.id, action: 'merge_template_created', targetId: rows[0].id, detail: { name, tags: tags.length } });
    return { id: rows[0].id, tags };
  });

  app.get('/api/merge/templates/:id', auth, async (req, reply) => {
    const t = await loadTemplate(req, reply, idParam(req));
    if (!t) return;
    const { rows: runs } = await query(
      `SELECT r.id, r.source_file, r.created_at, r.purged_at, u.display_name AS by, (SELECT count(*)::int FROM merge_rows m WHERE m.run_id = r.id) AS rows
         FROM merge_runs r LEFT JOIN users u ON u.id = r.created_by WHERE r.template_id = $1 ORDER BY r.created_at DESC LIMIT 24`,
      [t.id],
    );
    return { ...t, canEdit: canEdit(req, t), runs };
  });

  app.put('/api/merge/templates/:id', auth, async (req, reply) => {
    const t = await loadTemplate(req, reply, idParam(req));
    if (!t) return;
    if (!canEdit(req, t)) return reply.code(403).send({ error: 'Only the owner, a lead of the department or an admin can change this template' });
    const body = z
      .object({
        name: z.string().min(1).max(120).optional(),
        description: z.string().max(1000).optional(),
        mapping: MappingZ.optional(),
        filters: FiltersZ.optional(),
        email: EmailZ.optional(),
        filename_pattern: z.string().max(200).optional(),
        shared: z.boolean().optional(),
      })
      .parse(req.body);
    const sets: string[] = [];
    const vals: unknown[] = [t.id];
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined) continue;
      vals.push(['mapping', 'filters', 'email'].includes(k) ? JSON.stringify(v) : v);
      sets.push(`${k} = $${vals.length}`);
    }
    if (sets.length) await query(`UPDATE merge_templates SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, vals);
    return { ok: true };
  });

  app.delete('/api/merge/templates/:id', auth, async (req, reply) => {
    const t = await loadTemplate(req, reply, idParam(req));
    if (!t) return;
    if (!canEdit(req, t)) return reply.code(403).send({ error: 'Only the owner, a lead of the department or an admin can delete this template' });
    await query(`DELETE FROM merge_templates WHERE id = $1`, [t.id]);
    await writeAudit({ actorUserId: req.user.id, action: 'merge_template_deleted', targetId: t.id, detail: { name: t.name } });
    return { ok: true };
  });

  app.post('/api/merge/templates/:id/file', auth, async (req, reply) => {
    const t = await loadTemplate(req, reply, idParam(req));
    if (!t) return;
    if (!canEdit(req, t)) return reply.code(403).send({ error: 'Not allowed' });
    const { file } = await readUpload(req);
    if (!file || !/\.docx$/i.test(file.filename)) return reply.code(400).send({ error: 'Upload a Word document (.docx)' });
    let tags: string[];
    try {
      tags = extractTags(file.data);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
    await query(`UPDATE merge_templates SET docx = $2, file_name = $3, tags = $4, updated_at = now() WHERE id = $1`, [t.id, file.data, file.filename.slice(0, 200), tags]);
    return { tags };
  });

  app.get('/api/merge/templates/:id/file.docx', auth, async (req, reply) => {
    const t = await loadTemplate(req, reply, idParam(req), true);
    if (!t) return;
    return reply
      .type('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .header('content-disposition', `attachment; filename="${encodeURIComponent(t.file_name)}"`)
      .send(t.docx);
  });

  app.get('/api/merge/templates/:id/preview', auth, async (req, reply) => {
    const t = await loadTemplate(req, reply, idParam(req), true);
    if (!t) return;
    return { html: await previewHtml(t.docx), tags: t.tags };
  });

  // Select text in the preview → it becomes {{tag}} in the Word file (formatting kept).
  app.post('/api/merge/templates/:id/insert-tag', auth, async (req, reply) => {
    const t = await loadTemplate(req, reply, idParam(req), true);
    if (!t) return;
    if (!canEdit(req, t)) return reply.code(403).send({ error: 'Not allowed' });
    const { text, tag } = z.object({ text: z.string().min(1).max(500), tag: z.string().min(1).max(80) }).parse(req.body);
    try {
      const docx = insertTag(t.docx, text, tag);
      const tags = extractTags(docx);
      await query(`UPDATE merge_templates SET docx = $2, tags = $3, updated_at = now() WHERE id = $1`, [t.id, docx, tags]);
      return { tags };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  // AI suggests a column for tags the name match could not place (column names only; no row data).
  app.post('/api/merge/templates/:id/suggest', auth, async (req, reply) => {
    const t = await loadTemplate(req, reply, idParam(req));
    if (!t) return;
    const { headers, tags } = z.object({ headers: z.array(z.string().max(200)).max(200), tags: z.array(z.string().max(80)).max(100) }).parse(req.body);
    if (!tags.length || !headers.length) return { mapping: {} };
    const out = await gateway.call(
      'document',
      [
        { role: 'system', content: 'You match document template placeholders to spreadsheet column names. Reply with only a JSON object.' },
        {
          role: 'user',
          content: `Placeholders: ${JSON.stringify(tags)}\nSpreadsheet columns: ${JSON.stringify(headers)}\n\nFor each placeholder give the single column that holds its value, or null if none fits. Only use column names exactly as listed. Reply as {"placeholder": "column name or null"}.`,
        },
      ],
      { userId: req.user.id, sensitivity: 'low', priority: PRIORITY.quick, purpose: 'merge_suggest' },
    );
    const raw = /\{[\s\S]*\}/.exec(out.content)?.[0] ?? '{}';
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      /* ignore */
    }
    const mapping: Record<string, string> = {};
    for (const tag of tags) {
      const col = parsed[tag];
      if (typeof col === 'string' && headers.includes(col)) mapping[tag] = col;
    }
    return { mapping };
  });

  // ── Runs (one data upload) ─────────────────────────────────────────────────
  app.post('/api/merge/templates/:id/runs', auth, async (req, reply) => {
    const t = await loadTemplate(req, reply, idParam(req));
    if (!t) return;
    const { file, fields } = await readUpload(req);
    if (!file) return reply.code(400).send({ error: 'Upload the data (.xlsx or .csv)' });
    let data;
    try {
      data = await readData(file.filename, file.data, fields.sheet || t.sheet);
    } catch (err) {
      if (err instanceof SheetChoice) return reply.code(400).send({ error: err.message, sheets: err.sheets });
      return reply.code(400).send({ error: (err as Error).message });
    }
    const runDate = /^\d{4}-\d{2}-\d{2}$/.test(fields.runDate ?? '') ? fields.runDate : today();
    const runId = await tx(async (c) => {
      const r = await c.query(
        `INSERT INTO merge_runs (template_id, source_file, sheet, headers, run_date, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [t.id, file!.filename.slice(0, 200), data.sheet, data.headers, runDate, req.user.id],
      );
      const id = r.rows[0].id as string;
      // Batched inserts: one statement per 500 rows.
      for (let i = 0; i < data.rows.length; i += 500) {
        const chunk = data.rows.slice(i, i + 500);
        const vals: unknown[] = [id];
        const tuples = chunk.map((row) => {
          vals.push(row.rowNo, JSON.stringify(row.record));
          return `($1, $${vals.length - 1}, $${vals.length})`;
        });
        await c.query(`INSERT INTO merge_rows (run_id, row_no, record) VALUES ${tuples.join(', ')}`, vals);
      }
      return id;
    });
    // Remember the sheet, and fill in mapping for tags that have none yet.
    const mapping = autoMap(t.tags, data.headers, t.mapping);
    await query(`UPDATE merge_templates SET sheet = $2, mapping = $3, updated_at = now() WHERE id = $1`, [t.id, data.sheet, JSON.stringify(mapping)]);
    await writeAudit({ actorUserId: req.user.id, action: 'merge_run_created', targetId: runId, detail: { template: t.name, rows: data.rows.length } });
    return { id: runId, headers: data.headers, rows: data.rows.length };
  });

  function rowView(t: Template, runDate: string, r: { record: Row | null }) {
    if (!r.record) return { values: {}, blank: [], passes: false, email: null };
    const { values, blank } = valuesFor(r.record, t.tags, t.mapping, runDate);
    const email = t.email.toColumn ? cleanEmailValue(r.record[t.email.toColumn] ?? null) : null;
    return { values, blank, passes: passes(r.record, t.filters), email };
  }

  app.get('/api/merge/runs/:id', auth, async (req, reply) => {
    const x = await loadRun(req, reply, idParam(req));
    if (!x) return;
    const { rows } = await query(`SELECT id, row_no, record, excluded, delivery, delivery_error FROM merge_rows WHERE run_id = $1 ORDER BY row_no`, [x.run.id]);
    const { docx: _d, ...template } = x.t;
    return {
      run: x.run,
      template: { ...template, canEdit: canEdit(req, x.t) },
      rows: rows.map((r) => ({ id: r.id, row_no: r.row_no, excluded: r.excluded, delivery: r.delivery, delivery_error: r.delivery_error, ...rowView(x.t, x.run.run_date, r) })),
    };
  });

  app.patch('/api/merge/runs/:id/rows/:rowId', auth, async (req, reply) => {
    const { id, rowId } = z.object({ id: z.string().uuid(), rowId: z.string().uuid() }).parse(req.params);
    const x = await loadRun(req, reply, id);
    if (!x) return;
    const { excluded } = z.object({ excluded: z.boolean() }).parse(req.body);
    await query(`UPDATE merge_rows SET excluded = $3 WHERE id = $2 AND run_id = $1 AND delivery IS DISTINCT FROM 'sent'`, [id, rowId, excluded]);
    return { ok: true };
  });

  app.delete('/api/merge/runs/:id', auth, async (req, reply) => {
    const x = await loadRun(req, reply, idParam(req));
    if (!x) return;
    if (x.run.created_by !== req.user.id && !canEdit(req, x.t)) return reply.code(403).send({ error: 'Not allowed' });
    await query(`DELETE FROM merge_runs WHERE id = $1`, [x.run.id]);
    return { ok: true };
  });

  // ── Output ─────────────────────────────────────────────────────────────────
  type Fmt = 'docx' | 'pdf';
  async function documentFor(t: Template, runDate: string, row: { row_no: number; record: Row }, fmt: Fmt) {
    const { values } = valuesFor(row.record, t.tags, t.mapping, runDate);
    const docx = renderDocx(t.docx, values);
    const base = safeFileName(fillText(t.filename_pattern || `${t.name}_{{row}}`, { ...values, row: String(row.row_no) }));
    if (fmt === 'pdf') return { name: `${base}.pdf`, data: await docxToPdf(docx, `${base}.docx`), values, mime: 'application/pdf' };
    return { name: `${base}.docx`, data: docx, values, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  }
  const fmtOf = (req: FastifyRequest): Fmt => ((req.query as { format?: string }).format === 'pdf' ? 'pdf' : 'docx');

  async function selectedRows(runId: string, t: Template) {
    const { rows } = await query(`SELECT id, row_no, record, delivery FROM merge_rows WHERE run_id = $1 AND NOT excluded AND record IS NOT NULL ORDER BY row_no`, [runId]);
    return (rows as Array<{ id: string; row_no: number; record: Row; delivery: string | null }>).filter((r) => passes(r.record, t.filters));
  }

  app.get('/api/merge/runs/:id/rows/:rowId/document', auth, async (req, reply) => {
    const { id, rowId } = z.object({ id: z.string().uuid(), rowId: z.string().uuid() }).parse(req.params);
    const x = await loadRun(req, reply, id);
    if (!x) return;
    const { rows } = await query(`SELECT row_no, record FROM merge_rows WHERE id = $1 AND run_id = $2`, [rowId, id]);
    if (!rows[0]?.record) return reply.code(404).send({ error: 'Not found' });
    const fmt = fmtOf(req);
    if (fmt === 'pdf' && !pdfAvailable()) return reply.code(409).send({ error: 'PDF conversion is not set up on this server' });
    const doc = await documentFor(x.t, x.run.run_date, rows[0], fmt);
    return reply.type(doc.mime).header('content-disposition', `${fmt === 'pdf' ? 'inline' : 'attachment'}; filename="${encodeURIComponent(doc.name)}"`).send(doc.data);
  });

  const skippedCsv = async (runId: string, t: Template) => {
    const { rows } = await query(`SELECT row_no, record, excluded FROM merge_rows WHERE run_id = $1 AND record IS NOT NULL ORDER BY row_no`, [runId]);
    const out: Array<Array<string | number>> = [['Row', 'Why not included']];
    for (const r of rows) {
      if (r.excluded) out.push([r.row_no, 'Excluded by you']);
      else if (!passes(r.record, t.filters)) out.push([r.row_no, 'Did not match the template filters']);
    }
    return out.length > 1 ? csv(out) : null;
  };

  app.get('/api/merge/runs/:id/documents.zip', auth, async (req, reply) => {
    const x = await loadRun(req, reply, idParam(req));
    if (!x) return;
    const fmt = fmtOf(req);
    if (fmt === 'pdf' && !pdfAvailable()) return reply.code(409).send({ error: 'PDF conversion is not set up on this server' });
    const rows = await selectedRows(x.run.id, x.t);
    if (!rows.length) return reply.code(400).send({ error: 'No rows are selected' });
    const files: Array<{ name: string; data: Buffer | string }> = [];
    for (const r of rows) {
      const d = await documentFor(x.t, x.run.run_date, r, fmt);
      files.push({ name: d.name, data: d.data });
    }
    const skipped = await skippedCsv(x.run.id, x.t);
    if (skipped) files.push({ name: '_Rows not included.csv', data: skipped });
    await query(`INSERT INTO merge_log (run_id, template, actor_id, mode, status) VALUES ($1, $2, $3, 'documents', $4)`, [x.run.id, x.t.name, req.user.id, `downloaded ${rows.length} ${fmt} documents`]);
    await writeAudit({ actorUserId: req.user.id, action: 'merge_documents_downloaded', targetId: x.run.id, detail: { template: x.t.name, documents: rows.length, format: fmt } });
    return reply.type('application/zip').header('content-disposition', `attachment; filename="${encodeURIComponent(`${safeFileName(x.t.name)} ${x.run.run_date}.zip`)}"`).send(await zip(files));
  });

  function emailFor(t: Template, values: Record<string, string>) {
    const subject = fillText(t.email.subject || t.name, values).replace(/\s+/g, ' ').trim();
    const text = fillText(t.email.body || 'Please find the attached document.', values);
    const html = `<!DOCTYPE html><html><body style="font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; color: #1a1a1a; line-height: 1.5;">${text
      .split(/\n{2,}/)
      .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
      .join('\n')}</body></html>`;
    return { subject, text, html };
  }

  app.get('/api/merge/runs/:id/drafts.zip', auth, async (req, reply) => {
    const x = await loadRun(req, reply, idParam(req));
    if (!x) return;
    if (!x.t.email.toColumn) return reply.code(400).send({ error: 'Choose the email column in the template\'s Email settings first' });
    const fmt = fmtOf(req);
    if (fmt === 'pdf' && !pdfAvailable()) return reply.code(409).send({ error: 'PDF conversion is not set up on this server' });
    const rows = await selectedRows(x.run.id, x.t);
    const files: Array<{ name: string; data: Buffer | string }> = [];
    const noEmail: Array<Array<string | number>> = [];
    const drafted: Array<{ row_no: number; to: string }> = [];
    for (const r of rows) {
      const to = cleanEmailValue(r.record[x.t.email.toColumn] ?? null);
      if (!to) {
        noEmail.push([r.row_no, String(r.record[x.t.email.toColumn] ?? '')]);
        continue;
      }
      const d = await documentFor(x.t, x.run.run_date, r, fmt);
      const e = emailFor(x.t, { ...d.values, row: String(r.row_no) });
      const eml = await new MailComposer({ to, subject: e.subject, text: e.text, html: e.html, headers: { 'X-Unsent': '1' }, attachments: [{ filename: d.name, content: d.data, contentType: d.mime }] }).compile().build();
      files.push({ name: d.name.replace(/\.(docx|pdf)$/, '.eml'), data: eml });
      drafted.push({ row_no: r.row_no, to });
    }
    if (!files.length) return reply.code(400).send({ error: 'None of the selected rows has a valid email address' });
    if (noEmail.length) files.push({ name: '_No valid email.csv', data: csv([['Row', 'Email column value'], ...noEmail]) });
    const skipped = await skippedCsv(x.run.id, x.t);
    if (skipped) files.push({ name: '_Rows not included.csv', data: skipped });
    files.push({ name: '_HOW TO SEND.txt', data: ['1. Extract this zip.', '2. Double-click a .eml file: Outlook opens it as a new email, addressed, with the document attached.', '3. Check it and press Send.', '', 'Works with classic Outlook for Windows.'].join('\r\n') });
    for (const d of drafted) await query(`INSERT INTO merge_log (run_id, template, actor_id, mode, row_no, recipient, status) VALUES ($1, $2, $3, 'drafts', $4, $5, 'Outlook draft prepared')`, [x.run.id, x.t.name, req.user.id, d.row_no, d.to]);
    await writeAudit({ actorUserId: req.user.id, action: 'merge_drafts_downloaded', targetId: x.run.id, detail: { template: x.t.name, drafts: drafted.length } });
    return reply.type('application/zip').header('content-disposition', `attachment; filename="${encodeURIComponent(`${safeFileName(x.t.name)} Outlook drafts ${x.run.run_date}.zip`)}"`).send(await zip(files));
  });

  app.get('/api/merge/runs/:id/log.csv', auth, async (req, reply) => {
    const x = await loadRun(req, reply, idParam(req));
    if (!x) return;
    const { rows } = await query(`SELECT l.at, l.mode, l.row_no, l.recipient, l.status, u.display_name AS by FROM merge_log l LEFT JOIN users u ON u.id = l.actor_id WHERE l.run_id = $1 ORDER BY l.at`, [x.run.id]);
    return reply.type('text/csv').header('content-disposition', `attachment; filename="merge-log-${x.run.id.slice(0, 8)}.csv"`).send(csv([['Time', 'Mode', 'Row', 'Recipient', 'Status', 'By'], ...rows.map((r) => [new Date(r.at).toISOString(), r.mode, r.row_no, r.recipient, r.status, r.by])]));
  });

  // Direct sending uses the same customer mailbox as the notis blast (NOTIS_SMTP_*), off until set up.
  app.post('/api/merge/runs/:id/test', auth, async (req, reply) => {
    const x = await loadRun(req, reply, idParam(req));
    if (!x) return;
    const s = notisSender();
    if (!s) return reply.code(409).send({ error: 'Direct sending is not set up yet. Use Outlook drafts.' });
    const row = (await selectedRows(x.run.id, x.t))[0];
    if (!row) return reply.code(400).send({ error: 'No rows are selected' });
    const d = await documentFor(x.t, x.run.run_date, row, pdfAvailable() ? 'pdf' : 'docx');
    const e = emailFor(x.t, { ...d.values, row: String(row.row_no) });
    await s.send({ to: req.user.email, subject: e.subject, text: e.text, html: e.html, attachment: { filename: d.name, content: d.data } });
    await query(`INSERT INTO merge_log (run_id, template, actor_id, mode, row_no, recipient, status) VALUES ($1, $2, $3, 'test', $4, $5, 'sent (test copy)')`, [x.run.id, x.t.name, req.user.id, row.row_no, req.user.email]);
    return { sent: 1, to: req.user.email };
  });

  app.post('/api/merge/runs/:id/send', auth, async (req, reply) => {
    const x = await loadRun(req, reply, idParam(req));
    if (!x) return;
    const { confirm } = z.object({ confirm: z.string() }).parse(req.body ?? {});
    if (req.user.role !== 'admin' && req.user.role !== 'dept_lead') return reply.code(403).send({ error: 'Sending emails from the Council needs a department lead or an admin' });
    if (!notisSender()) return reply.code(409).send({ error: 'Direct sending is not set up yet. Use Outlook drafts.' });
    if (confirm !== 'SEND') return reply.code(400).send({ error: 'Type SEND to confirm' });
    if (!x.t.email.toColumn) return reply.code(400).send({ error: 'Choose the email column in the template\'s Email settings first' });
    const ids = (await selectedRows(x.run.id, x.t)).filter((r) => r.delivery !== 'sent' && cleanEmailValue(r.record[x.t.email.toColumn!] ?? null)).map((r) => r.id);
    if (ids.length) await query(`UPDATE merge_rows SET delivery = 'queued', delivery_by = $2, delivery_error = NULL WHERE id = ANY($1::uuid[])`, [ids, req.user.id]);
    await writeAudit({ actorUserId: req.user.id, action: 'merge_send_started', targetId: x.run.id, detail: { template: x.t.name, queued: ids.length } });
    return { queued: ids.length };
  });
}

/** Worker tick: sends queued merge emails a few at a time (same mailbox and pacing as the notis blast). */
export async function sendQueuedMerge(limit = 20, pauseMs = 2500) {
  const s = notisSender();
  if (!s) return 0;
  const { rows } = await query(
    `SELECT m.id, m.run_id, m.row_no, m.record, m.delivery_by, to_char(r.run_date, 'YYYY-MM-DD') AS run_date, t.*
       FROM merge_rows m JOIN merge_runs r ON r.id = m.run_id JOIN merge_templates t ON t.id = r.template_id
      WHERE m.delivery = 'queued' AND m.record IS NOT NULL ORDER BY r.created_at, m.row_no LIMIT $1`,
    [limit],
  );
  for (const [i, row] of rows.entries()) {
    if (i) await new Promise((res) => setTimeout(res, pauseMs));
    const t = row as unknown as Template;
    const to = cleanEmailValue(row.record[t.email.toColumn ?? ''] ?? null);
    try {
      if (!to) throw new Error('No valid email address');
      const { values } = valuesFor(row.record, t.tags, t.mapping, row.run_date);
      const docx = renderDocx(t.docx, values);
      const base = safeFileName(fillText(t.filename_pattern || `${t.name}_{{row}}`, { ...values, row: String(row.row_no) }));
      const attachment = pdfAvailable() ? { filename: `${base}.pdf`, content: await docxToPdf(docx, `${base}.docx`) } : { filename: `${base}.docx`, content: docx };
      const subject = fillText(t.email.subject || t.name, values).replace(/\s+/g, ' ').trim();
      const text = fillText(t.email.body || 'Please find the attached document.', values);
      const html = `<!DOCTYPE html><html><body style="font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; line-height: 1.5;">${text.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('\n')}</body></html>`;
      await s.send({ to, subject, text, html, attachment });
      await query(`UPDATE merge_rows SET delivery = 'sent', delivery_to = $2, delivered_at = now(), delivery_error = NULL WHERE id = $1`, [row.id, to]);
      await query(`INSERT INTO merge_log (run_id, template, actor_id, mode, row_no, recipient, status) VALUES ($1, $2, $3, 'live', $4, $5, 'sent')`, [row.run_id, t.name, row.delivery_by, row.row_no, to]);
    } catch (err) {
      const msg = (err as Error).message.slice(0, 300);
      await query(`UPDATE merge_rows SET delivery = 'failed', delivery_error = $2 WHERE id = $1`, [row.id, msg]);
      await query(`INSERT INTO merge_log (run_id, template, actor_id, mode, row_no, recipient, status) VALUES ($1, $2, $3, 'live', $4, $5, $6)`, [row.run_id, t.name, row.delivery_by, row.row_no, to, `error: ${msg}`]);
    }
  }
  return rows.length;
}
