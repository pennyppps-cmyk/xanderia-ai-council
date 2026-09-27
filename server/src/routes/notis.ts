import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { z } from 'zod';
import { writeAudit } from '../audit.js';
import { query, tx } from '../db/pool.js';
import { letterFileName, outlookDraft, renderLetter, emailBody, zip } from '../notis/letter.js';
import { checkMasterlist, cleanEmail, DEFAULT_HOLD_COLUMN, msDate, readSheet, SheetNotFound, type LetterData } from '../notis/masterlist.js';
import { notisSender, sendOne } from '../notis/send.js';
import { getSetting } from '../settings.js';

/**
 * Notis blast workspace (Collections): upload the monthly masterlist → every row checked →
 * letters (PDF) and Outlook drafts for the batch, or direct sending once a mailbox is set up.
 * Open to admins and to the departments in `notis_departments`; sending to customers needs a
 * department lead or admin.
 */
const MAX = 25 * 1024 * 1024;

async function access(req: FastifyRequest) {
  if (req.user.role === 'admin') return { use: true, send: true };
  const depts = await getSetting<string[]>('notis_departments', ['credit-collections']);
  const { rows } = await query(`SELECT slug FROM departments WHERE id = $1`, [req.user.department_id]);
  const use = !!rows[0] && depts.includes(rows[0].slug);
  return { use, send: use && req.user.role === 'dept_lead' };
}

const csv = (rows: Array<Array<string | number | null>>) =>
  '﻿' + rows.map((r) => r.map((v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\r\n');

const today = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10); // Malaysia date

export default async function notisRoutes(app: FastifyInstance) {
  const guard = async (req: FastifyRequest, reply: FastifyReply) => {
    await app.authenticate(req, reply);
    if (reply.sent) return;
    if (!(await access(req)).use) return reply.code(403).send({ error: 'The notis blast workspace is for Collections. Ask an admin for access.' });
  };
  const auth = { preHandler: guard };

  async function batchOf(id: string) {
    const { rows } = await query(
      `SELECT id, name, source_file, sheet, to_char(notice_date, 'YYYY-MM-DD') AS notice_date, to_char(as_of_default, 'YYYY-MM-DD') AS as_of_default,
              created_by, created_at, purged_at FROM notis_batches WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async function includedRows(batchId: string) {
    const { rows } = await query(
      `SELECT id, row_no, email, data, account_number, customer_name FROM notis_rows
        WHERE batch_id = $1 AND included AND state = 'ready' AND data IS NOT NULL ORDER BY row_no`,
      [batchId],
    );
    return rows as Array<{ id: string; row_no: number; email: string; data: LetterData; account_number: string; customer_name: string }>;
  }

  app.get('/api/notis/access', { preHandler: app.authenticate }, async (req) => {
    const a = await access(req);
    return { ...a, directSending: !!notisSender(), me: req.user.email };
  });

  // ── Batches ────────────────────────────────────────────────────────────────
  app.post('/api/notis/batches', auth, async (req, reply) => {
    let file: { filename: string; data: Buffer } | null = null;
    const fields: Record<string, string> = {};
    for await (const part of req.parts({ limits: { fileSize: MAX } })) {
      if (part.type === 'file') {
        const f = part as MultipartFile;
        const data = await f.toBuffer();
        if (f.file.truncated) return reply.code(413).send({ error: 'The file is larger than 25 MB' });
        file = { filename: f.filename, data };
      } else fields[part.fieldname] = String((part as { value: unknown }).value ?? '');
    }
    if (!file) return reply.code(400).send({ error: 'Upload the masterlist (.xlsx)' });
    const noticeDate = /^\d{4}-\d{2}-\d{2}$/.test(fields.noticeDate ?? '') ? fields.noticeDate : today();
    let list;
    try {
      const sheet = await readSheet(file.filename, file.data, fields.sheet || undefined);
      list = checkMasterlist(sheet.headers, sheet.rows, {
        holdColumn: await getSetting<string>('notis_hold_column', DEFAULT_HOLD_COLUMN),
        sheets: sheet.sheets,
        sheet: sheet.sheet,
      });
    } catch (err) {
      if (err instanceof SheetNotFound) return reply.code(400).send({ error: err.message, sheets: err.sheets });
      return reply.code(400).send({ error: (err as Error).message });
    }
    if (!list.rows.length) return reply.code(400).send({ error: 'No customer rows found in that sheet' });
    const name = (fields.name || '').trim().slice(0, 120) || `Notis ${msDate(noticeDate)}`;
    const batchId = await tx(async (c) => {
      const b = await c.query(
        `INSERT INTO notis_batches (name, source_file, sheet, notice_date, as_of_default, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [name, file!.filename.slice(0, 200), list.sheet, noticeDate, list.asOfDefault, req.user.id],
      );
      const id = b.rows[0].id as string;
      for (const r of list.rows) {
        await c.query(
          `INSERT INTO notis_rows (batch_id, row_no, state, included, account_number, customer_name, email, data, reasons, warnings)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [id, r.rowNo, r.state, r.state === 'ready', r.data.account_number, r.data.customer_name, r.email, r.data, r.reasons, r.warnings],
        );
      }
      return id;
    });
    await writeAudit({ actorUserId: req.user.id, action: 'notis_batch_created', targetId: batchId, detail: { rows: list.rows.length, sheet: list.sheet } });
    return { id: batchId, columns: list.columns, holdColumn: list.holdColumn };
  });

  app.get('/api/notis/batches', auth, async () => {
    const { rows } = await query(
      `SELECT b.id, b.name, b.source_file, to_char(b.notice_date, 'YYYY-MM-DD') AS notice_date, b.created_at, b.purged_at,
              u.display_name AS created_by,
              count(r.*)::int AS total,
              count(r.*) FILTER (WHERE r.state = 'ready' AND r.included)::int AS included,
              count(r.*) FILTER (WHERE r.delivery = 'sent')::int AS sent,
              (SELECT count(*)::int FROM notis_log l WHERE l.batch_id = b.id AND l.mode = 'drafts') AS drafted
         FROM notis_batches b LEFT JOIN users u ON u.id = b.created_by LEFT JOIN notis_rows r ON r.batch_id = b.id
        GROUP BY b.id, u.display_name ORDER BY b.created_at DESC LIMIT 50`,
    );
    return rows;
  });

  app.get('/api/notis/batches/:id', auth, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const batch = await batchOf(id);
    if (!batch) return reply.code(404).send({ error: 'Not found' });
    const { rows } = await query(
      `SELECT id, row_no, state, included, account_number, customer_name, email, reasons, warnings, delivery, delivery_error, delivered_at,
              data->>'month_in_arrears' AS months, (data->>'overdue_month')::float AS overdue, (data->>'outstanding_amount')::float AS amount
         FROM notis_rows WHERE batch_id = $1 ORDER BY row_no`,
      [id],
    );
    return { batch, rows };
  });

  app.delete('/api/notis/batches/:id', auth, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const batch = await batchOf(id);
    if (!batch) return reply.code(404).send({ error: 'Not found' });
    if (req.user.role !== 'admin' && batch.created_by !== req.user.id) return reply.code(403).send({ error: 'Only the person who uploaded the batch (or an admin) can delete it' });
    const { rows } = await query(`SELECT count(*)::int AS n FROM notis_rows WHERE batch_id = $1 AND delivery = 'queued'`, [id]);
    if (rows[0].n) return reply.code(409).send({ error: 'Notices from this batch are still being sent' });
    await query(`DELETE FROM notis_batches WHERE id = $1`, [id]);
    await writeAudit({ actorUserId: req.user.id, action: 'notis_batch_deleted', targetId: id, detail: { name: batch.name } });
    return { ok: true };
  });

  // ── Rows ───────────────────────────────────────────────────────────────────
  app.patch('/api/notis/rows/:id', auth, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ included: z.boolean().optional(), email: z.string().max(200).optional() }).parse(req.body);
    const { rows } = await query(`SELECT state, reasons, delivery, data FROM notis_rows WHERE id = $1`, [id]);
    const r = rows[0];
    if (!r) return reply.code(404).send({ error: 'Not found' });
    if (r.delivery === 'sent' || r.delivery === 'queued') return reply.code(409).send({ error: 'This notice has already been sent' });
    if (!r.data) return reply.code(409).send({ error: 'This batch has been purged' });
    let { state, reasons } = r as { state: string; reasons: string[] };
    const sets: string[] = [];
    const vals: unknown[] = [id];
    if (body.email !== undefined) {
      const e = cleanEmail(body.email);
      if (!e) return reply.code(400).send({ error: 'That email address is not valid' });
      vals.push(e);
      sets.push(`email = $${vals.length}`);
      if (state === 'no_email') {
        reasons = reasons.filter((x) => !/^No email address|^Email address is not valid/.test(x));
        state = reasons.length ? 'incomplete' : 'ready';
        vals.push(state, reasons);
        sets.push(`state = $${vals.length - 1}`, `reasons = $${vals.length}`, `included = ${state === 'ready'}`);
      }
    }
    if (body.included !== undefined) {
      if (state !== 'ready' && body.included) return reply.code(400).send({ error: 'Only rows that passed the checks can be included' });
      vals.push(body.included);
      sets.push(`included = $${vals.length}`);
    }
    if (sets.length) await query(`UPDATE notis_rows SET ${sets.join(', ')} WHERE id = $1`, vals);
    return { ok: true, state };
  });

  async function rowFor(req: FastifyRequest, reply: FastifyReply) {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { rows } = await query(
      `SELECT r.email, r.data, to_char(b.notice_date, 'YYYY-MM-DD') AS notice_date FROM notis_rows r JOIN notis_batches b ON b.id = r.batch_id WHERE r.id = $1`,
      [id],
    );
    if (!rows[0]) return void reply.code(404).send({ error: 'Not found' });
    if (!rows[0].data) return void reply.code(410).send({ error: 'This batch has been purged' });
    return rows[0] as { email: string | null; data: LetterData; notice_date: string };
  }

  app.get('/api/notis/rows/:id/letter.pdf', auth, async (req, reply) => {
    const r = await rowFor(req, reply);
    if (!r) return;
    const pdf = await renderLetter(r.data, msDate(r.notice_date));
    return reply.type('application/pdf').header('content-disposition', `inline; filename="${letterFileName(r.data)}"`).send(pdf);
  });

  app.get('/api/notis/rows/:id/email', auth, async (req, reply) => {
    const r = await rowFor(req, reply);
    if (!r) return;
    return { to: r.email, ...emailBody(r.data) };
  });

  // ── Output ─────────────────────────────────────────────────────────────────
  const notSentCsv = async (batchId: string) => {
    const { rows } = await query(
      `SELECT row_no, customer_name, account_number, email, state, included, reasons FROM notis_rows
        WHERE batch_id = $1 AND NOT (state = 'ready' AND included) ORDER BY row_no`,
      [batchId],
    );
    const label: Record<string, string> = { held: 'Held by Finance', no_email: 'No valid email', incomplete: 'Incomplete data', ready: 'Excluded by you' };
    return csv([['Row', 'Customer', 'Account', 'Email', 'Why not sent', 'Details'], ...rows.map((r) => [r.row_no, r.customer_name, r.account_number, r.email, label[r.state], (r.reasons as string[]).join(' | ')])]);
  };

  app.get('/api/notis/batches/:id/letters.zip', auth, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const batch = await batchOf(id);
    if (!batch) return reply.code(404).send({ error: 'Not found' });
    const rows = await includedRows(id);
    if (!rows.length) return reply.code(400).send({ error: 'No rows are included' });
    const date = msDate(batch.notice_date);
    const files: Array<{ name: string; data: Buffer | string }> = [];
    for (const r of rows) files.push({ name: letterFileName(r.data), data: await renderLetter(r.data, date) });
    files.push({ name: '_Not sent - follow up.csv', data: await notSentCsv(id) });
    await query(`INSERT INTO notis_log (batch_id, actor_id, mode, status) VALUES ($1, $2, 'pdfs', $3)`, [id, req.user.id, `downloaded ${rows.length} letters`]);
    await writeAudit({ actorUserId: req.user.id, action: 'notis_letters_downloaded', targetId: id, detail: { letters: rows.length } });
    return reply.type('application/zip').header('content-disposition', `attachment; filename="Notis letters ${batch.notice_date}.zip"`).send(await zip(files));
  });

  app.get('/api/notis/batches/:id/drafts.zip', auth, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const batch = await batchOf(id);
    if (!batch) return reply.code(404).send({ error: 'Not found' });
    const rows = await includedRows(id);
    if (!rows.length) return reply.code(400).send({ error: 'No rows are included' });
    const date = msDate(batch.notice_date);
    const files: Array<{ name: string; data: Buffer | string }> = [];
    for (const r of rows) {
      const pdf = await renderLetter(r.data, date);
      files.push({ name: letterFileName(r.data).replace(/\.pdf$/, '.eml'), data: await outlookDraft(r.email, r.data, pdf) });
    }
    files.push({ name: '_Not sent - follow up.csv', data: await notSentCsv(id) });
    files.push({
      name: '_HOW TO SEND.txt',
      data: [
        `Notis blast: ${batch.name} (${rows.length} drafts)`,
        '',
        '1. Extract this zip.',
        '2. Double-click a .eml file: it opens in Outlook as a new email, addressed, with the letter attached.',
        '3. Check the name, amount and months, then press Send.',
        '',
        'Works with classic Outlook for Windows. If a file opens read-only (new Outlook / web), use the letters zip instead.',
        'Customers that were not included are listed in "_Not sent - follow up.csv".',
      ].join('\r\n'),
    });
    await query(
      `INSERT INTO notis_log (batch_id, actor_id, mode, account_number, customer_name, recipient, status)
       SELECT $1, $2, 'drafts', account_number, customer_name, email, 'Outlook draft prepared' FROM notis_rows
        WHERE batch_id = $1 AND included AND state = 'ready' AND data IS NOT NULL`,
      [id, req.user.id],
    );
    await writeAudit({ actorUserId: req.user.id, action: 'notis_drafts_downloaded', targetId: id, detail: { drafts: rows.length } });
    return reply.type('application/zip').header('content-disposition', `attachment; filename="Notis Outlook drafts ${batch.notice_date}.zip"`).send(await zip(files));
  });

  app.get('/api/notis/batches/:id/log.csv', auth, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { rows } = await query(
      `SELECT l.at, l.mode, l.account_number, l.customer_name, l.recipient, l.status, u.display_name AS by
         FROM notis_log l LEFT JOIN users u ON u.id = l.actor_id WHERE l.batch_id = $1 ORDER BY l.at`,
      [id],
    );
    const body = csv([['Time', 'Mode', 'Account', 'Customer', 'Recipient', 'Status', 'By'], ...rows.map((r) => [new Date(r.at).toISOString(), r.mode, r.account_number, r.customer_name, r.recipient, r.status, r.by])]);
    return reply.type('text/csv').header('content-disposition', `attachment; filename="notis-log-${id.slice(0, 8)}.csv"`).send(body);
  });

  // ── Direct sending (only when a Collections mailbox is configured) ─────────
  app.post('/api/notis/batches/:id/test', auth, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { count } = z.object({ count: z.number().int().min(1).max(3).default(1) }).parse(req.body ?? {});
    const s = notisSender();
    if (!s) return reply.code(409).send({ error: 'Direct sending is not set up yet. Use Outlook drafts.' });
    const batch = await batchOf(id);
    if (!batch) return reply.code(404).send({ error: 'Not found' });
    const rows = (await includedRows(id)).slice(0, count);
    for (const r of rows) {
      await sendOne(req.user.email, r.data, msDate(batch.notice_date), s);
      await query(`INSERT INTO notis_log (batch_id, actor_id, mode, account_number, customer_name, recipient, status) VALUES ($1, $2, 'test', $3, $4, $5, 'sent (test copy)')`, [id, req.user.id, r.account_number, r.customer_name, req.user.email]);
    }
    return { sent: rows.length, to: req.user.email };
  });

  app.post('/api/notis/batches/:id/send', auth, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { confirm } = z.object({ confirm: z.string() }).parse(req.body ?? {});
    if (!(await access(req)).send) return reply.code(403).send({ error: 'Sending to customers needs a Collections department lead or an admin' });
    if (!notisSender()) return reply.code(409).send({ error: 'Direct sending is not set up yet. Use Outlook drafts.' });
    if (confirm !== 'SEND') return reply.code(400).send({ error: 'Type SEND to confirm' });
    const { rowCount } = await query(
      `UPDATE notis_rows SET delivery = 'queued', delivery_by = $2, delivery_error = NULL
        WHERE batch_id = $1 AND included AND state = 'ready' AND data IS NOT NULL AND (delivery IS NULL OR delivery = 'failed')`,
      [id, req.user.id],
    );
    await writeAudit({ actorUserId: req.user.id, action: 'notis_send_started', targetId: id, detail: { queued: rowCount } });
    return { queued: rowCount ?? 0 };
  });
}
