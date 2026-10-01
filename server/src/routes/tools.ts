import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { z } from 'zod';
import { writeAudit } from '../audit.js';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { queueNoticeEmail } from '../jobs.js';
import { PRIORITY } from '../llm/gate.js';
import { gateway } from '../llm/registry.js';
import { assemblePrompt } from '../prompts/assembler.js';
import { renderPortfolioReport } from '../report/portfolioReport.js';
import { getSetting } from '../settings.js';
import { analyseArrears, arrearsMarkdown, readTable } from '../tools/arrears.js';
import { reconcileDeductions } from '../tools/deductions.js';
import { affordabilityMarkdown, assessAffordability, parsePayslipReport } from '../tools/payslip.js';
import { analysePortfolio, portfolioMarkdown, type PortfolioSummary } from '../tools/portfolio.js';
import { startCouncil } from '../council/start.js';
import { breachQuestion, DEFAULT_LIMITS, portfolioBreaches, type PortfolioLimits } from '../work/data.js';

/**
 * Working tools next to the chat. Uploaded files are read in memory and never stored; only the
 * portfolio report keeps its aggregates (never account rows) as a monthly snapshot.
 */
const MAX = 25 * 1024 * 1024;

/** All files and fields of a multipart request. */
async function readParts(req: FastifyRequest) {
  const files: Record<string, { filename: string; data: Buffer }> = {};
  const fields: Record<string, string> = {};
  for await (const part of req.parts({ limits: { fileSize: MAX } })) {
    if (part.type === 'file') {
      const f = part as MultipartFile;
      const data = await f.toBuffer();
      if (f.file.truncated) throw Object.assign(new Error('A file is larger than 25 MB'), { statusCode: 413 });
      files[f.fieldname] = { filename: f.filename, data };
    } else {
      fields[part.fieldname] = String((part as { value: unknown }).value ?? '');
    }
  }
  return { files, fields };
}

const isLead = (req: FastifyRequest) => req.user.role === 'admin' || req.user.role === 'dept_lead';

export default async function toolRoutes(app: FastifyInstance) {
  const auth = { preHandler: app.authenticate };
  const fail = (reply: any, err: unknown) =>
    reply.code((err as { statusCode?: number }).statusCode ?? 422).send({ error: (err as Error).message });

  /** Arrears file → bucket / branch / product aggregates. The file is not stored. */
  app.post('/api/tools/arrears', auth, async (req, reply) => {
    const file = await req.file({ limits: { fileSize: MAX } });
    if (!file) return reply.code(400).send({ error: 'No file uploaded' });
    const data = await file.toBuffer();
    if (file.file.truncated) return reply.code(413).send({ error: 'The file is larger than 25 MB' });
    try {
      const { headers, rows } = await readTable(file.filename, data);
      const summary = analyseArrears(headers, rows);
      await writeAudit({ actorUserId: req.user.id, action: 'arrears_analysed', detail: { file: file.filename, rows: summary.rows, skipped: summary.skipped, columns: summary.columns } });
      return { ...summary, headers, markdown: arrearsMarkdown(summary) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  // ── Portfolio report ──
  /** Loan export (this month, optionally last month for roll rates) → figures; leads/admins may save the month's snapshot. */
  app.post('/api/tools/portfolio', auth, async (req, reply) => {
    try {
      const { files, fields } = await readParts(req);
      if (!files.file) return reply.code(400).send({ error: 'No loan export uploaded' });
      const month = /^\d{4}-\d{2}$/.test(fields.month ?? '') ? fields.month : new Date().toISOString().slice(0, 7);
      const current = await readTable(files.file.filename, files.file.data);
      const previous = files.previous ? await readTable(files.previous.filename, files.previous.data) : undefined;
      const summary = analysePortfolio(current.headers, current.rows, {
        nplDays: Number(await getSetting('portfolio_npl_days', 90)),
        restructuredIsNpl: Boolean(await getSetting('portfolio_restructured_is_npl', true)),
      }, previous);
      let snapshotId: string | null = null;
      if (fields.save === 'true' && isLead(req)) {
        const { rows } = await query(
          `INSERT INTO portfolio_snapshots (month, summary, source_file, created_by) VALUES ($1, $2, $3, $4)
           ON CONFLICT (month) DO UPDATE SET summary = EXCLUDED.summary, source_file = EXCLUDED.source_file, commentary = NULL,
                                             created_by = EXCLUDED.created_by, updated_at = now()
           RETURNING id`,
          [month, JSON.stringify(summary), files.file.filename, req.user.id],
        );
        snapshotId = rows[0].id;
      }
      await writeAudit({ actorUserId: req.user.id, action: 'portfolio_analysed', detail: { file: files.file.filename, rows: summary.rows, month, saved: Boolean(snapshotId), columns: summary.columns } });
      const trend = await trendUpTo(month, summary);
      const markdown = portfolioMarkdown(summary, month, trend);
      // A saved month that breaks management's limits gets one automatic council run.
      let alert: { breaches: string[]; conversationId: string | null } | null = null;
      if (snapshotId) {
        const limits = { ...DEFAULT_LIMITS, ...(await getSetting<Partial<PortfolioLimits>>('portfolio_alerts', DEFAULT_LIMITS)) };
        const breaches = limits.enabled ? portfolioBreaches(summary, limits) : [];
        if (breaches.length) {
          const { rows: prev } = await query(`SELECT alert_message_id FROM portfolio_snapshots WHERE id = $1`, [snapshotId]);
          let conversationId: string | null = null;
          if (!prev[0]?.alert_message_id) {
            const run = await startCouncil({
              userId: req.user.id,
              departmentId: req.user.department_id,
              title: `Portfolio limits broken: ${month}`,
              question: breachQuestion(month, breaches, markdown.slice(0, 6000)),
              purpose: 'portfolio_alert',
            });
            await query(`UPDATE portfolio_snapshots SET alert_message_id = $2 WHERE id = $1`, [snapshotId, run.messageId]);
            conversationId = run.conversationId;
          }
          alert = { breaches, conversationId };
        }
      }
      return { month, snapshotId, summary, trend, markdown, alert };
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.get('/api/tools/portfolio', auth, async () => {
    const { rows } = await query(
      `SELECT s.id, s.month, (s.summary->>'nplRatio')::float AS "nplRatio", (s.summary->'par'->>'par30')::float AS par30,
              (s.summary->'total'->>'accounts')::int AS accounts, (s.summary->'total'->>'balance')::float AS balance,
              s.commentary IS NOT NULL AS has_commentary, u.display_name AS created_by, s.updated_at
         FROM portfolio_snapshots s LEFT JOIN users u ON u.id = s.created_by ORDER BY s.month DESC LIMIT 36`,
    );
    return rows;
  });

  /** The council's commentary on a saved month (figures only; nothing account-level is sent). */
  app.post('/api/tools/portfolio/:id/commentary', auth, async (req, reply) => {
    if (!isLead(req)) return reply.code(403).send({ error: 'Department leads and admins can write the report' });
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { lang } = z.object({ lang: z.enum(['en', 'ms']).default('en') }).parse(req.body ?? {});
    const snap = await loadSnapshot(id);
    if (!snap) return reply.code(404).send({ error: 'Not found' });
    const trend = await trendUpTo(snap.month, snap.summary);
    const system = (await assemblePrompt({ task: 'portfolio_commentary' })) + (lang === 'ms' ? '\n\nWrite in Bahasa Malaysia.' : '');
    const out = await gateway.call(
      'document',
      [
        { role: 'system', content: system },
        { role: 'user', content: `Figures (data):\n\n${portfolioMarkdown(snap.summary, snap.month, trend)}\n\nRules: compare with earlier months only if the NPL trend lists them. Branch, product and employer names are codes: repeat them exactly, never expand or guess what they stand for.` },
      ],
      { userId: req.user.id, sensitivity: 'high', priority: PRIORITY.quick, purpose: 'portfolio_commentary' },
    );
    const commentary = out.content.trim();
    await query(`UPDATE portfolio_snapshots SET commentary = $2, updated_at = now() WHERE id = $1`, [id, commentary]);
    await writeAudit({ actorUserId: req.user.id, action: 'portfolio_commentary', targetId: id, detail: { month: snap.month } });
    return { commentary };
  });

  app.get('/api/tools/portfolio/:id/report.pdf', auth, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const snap = await loadSnapshot(id);
    if (!snap) return reply.code(404).send({ error: 'Not found' });
    const trend = await trendUpTo(snap.month, snap.summary);
    const pdf = await renderPortfolioReport({ month: snap.month, summary: snap.summary, commentary: snap.commentary, trend, generatedBy: snap.created_by ?? 'Xanderia AI Council' });
    await writeAudit({ actorUserId: req.user.id, action: 'portfolio_report_downloaded', targetId: id, detail: { month: snap.month } });
    return reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `attachment; filename="Xanderia-portfolio-report-${snap.month}.pdf"`)
      .header('cache-control', 'private, no-store')
      .send(pdf);
  });

  /** Email Management a link to the month's report (recipients: Admin → Settings). */
  app.post('/api/tools/portfolio/:id/email', auth, async (req, reply) => {
    if (!isLead(req)) return reply.code(403).send({ error: 'Department leads and admins can send the report' });
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const snap = await loadSnapshot(id);
    if (!snap) return reply.code(404).send({ error: 'Not found' });
    const recipients = (await getSetting<string[]>('portfolio_report_recipients', [])).filter(Boolean);
    if (!recipients.length) return reply.code(400).send({ error: 'No recipients yet: add Management emails in Admin → Settings → Portfolio report recipients.' });
    const s = snap.summary;
    const link = `${config.APP_BASE_URL.replace(/\/+$/, '')}/api/tools/portfolio/${id}/report.pdf`;
    for (const to of recipients) {
      await queueNoticeEmail(
        'digest',
        to,
        `Portfolio report ${snap.month}: NPL ${(s.nplRatio * 100).toFixed(2)}% / Laporan portfolio`,
        [
          `The loan portfolio report for ${snap.month} is ready.`,
          `NPL ratio ${(s.nplRatio * 100).toFixed(2)}% · PAR30 ${(s.par.par30 * 100).toFixed(2)}% · PAR90 ${(s.par.par90 * 100).toFixed(2)}% · ${s.total.accounts.toLocaleString()} accounts, RM ${Math.round(s.total.balance).toLocaleString('en-MY')} outstanding.`,
          snap.commentary ? snap.commentary.split('\n').filter((l) => l.trim()).slice(0, 6).join('\n') : '',
          'Laporan portfolio pinjaman bulan ini sudah sedia. Log masuk untuk memuat turun PDF.',
        ].filter(Boolean),
        { label: 'Download the PDF report / Muat turun laporan', href: link },
      );
    }
    await writeAudit({ actorUserId: req.user.id, action: 'portfolio_report_emailed', targetId: id, detail: { month: snap.month, recipients: recipients.length } });
    return { queued: recipients.length };
  });

  // ── Salary-deduction reconciliation ──
  app.post('/api/tools/deductions', auth, async (req, reply) => {
    try {
      const { files, fields } = await readParts(req);
      if (!files.expected || !files.received) return reply.code(400).send({ error: 'Upload both files: the loan instalments and the deduction file' });
      const expected = await readTable(files.expected.filename, files.expected.data);
      const received = await readTable(files.received.filename, files.received.data);
      const result = reconcileDeductions(expected, received, Number(fields.tolerance) || 1);
      await writeAudit({
        actorUserId: req.user.id,
        action: 'deductions_reconciled',
        detail: { files: [files.expected.filename, files.received.filename], loans: result.loans, matched: result.matched, counts: result.counts },
      });
      const rmF = (n: number) => `RM ${n.toLocaleString('en-MY', { minimumFractionDigits: 2 })}`;
      const markdown = [
        `**Salary-deduction reconciliation** (matched on ${result.matchedOn === 'ic' ? 'IC number' : result.matchedOn === 'account' ? 'account number' : 'salary number'}; figures only)`,
        `${result.loans.toLocaleString()} loans expected ${rmF(result.amounts.expected)}; the deduction file has ${rmF(result.amounts.deducted)}. ${result.matched.toLocaleString()} matched.`,
        `Not deducted: ${result.counts.missing} · Short: ${result.counts.short} · Over: ${result.counts.over} · Deductions with no matching loan: ${result.counts.unknown}. Shortfall: ${rmF(result.amounts.shortfall)}.`,
      ].join('\n');
      return { ...result, markdown };
    } catch (err) {
      return fail(reply, err);
    }
  });

  // ── Payslip affordability ──
  app.post('/api/tools/affordability', auth, async (req, reply) => {
    try {
      const { files, fields } = await readParts(req);
      if (!files.file) return reply.code(400).send({ error: 'Upload the payslip extractor report (.xlsx)' });
      const f = z
        .object({
          instalment: z.coerce.number().positive(),
          amount: z.coerce.number().positive().optional(),
          tenure: z.coerce.number().int().positive().optional(),
          rate: z.coerce.number().nonnegative().optional(),
        })
        .parse({ instalment: fields.instalment, amount: fields.amount || undefined, tenure: fields.tenure || undefined, rate: fields.rate || undefined });
      const slips = await parsePayslipReport(files.file.data);
      const result = assessAffordability(slips, {
        instalment: f.instalment,
        maxDeductionPct: Number(await getSetting('affordability_max_deduction_pct', 60)),
        minNet: Number(await getSetting('affordability_min_net', 0)),
      });
      await writeAudit({ actorUserId: req.user.id, action: 'affordability_checked', detail: { file: files.file.filename, payslips: slips.length, verdict: result.verdict } });
      return { ...result, markdown: affordabilityMarkdown(result, f) };
    } catch (err) {
      return fail(reply, err);
    }
  });
}

async function loadSnapshot(id: string) {
  const { rows } = await query(
    `SELECT s.month, s.summary, s.commentary, u.display_name AS created_by FROM portfolio_snapshots s LEFT JOIN users u ON u.id = s.created_by WHERE s.id = $1`,
    [id],
  );
  return rows[0] ? { month: rows[0].month as string, summary: rows[0].summary as PortfolioSummary, commentary: rows[0].commentary as string | null, created_by: rows[0].created_by as string | null } : null;
}

/** Saved months up to (and including) this one, oldest first; the current figures replace a saved same month. */
async function trendUpTo(month: string, current: PortfolioSummary) {
  const { rows } = await query(
    `SELECT month, (summary->>'nplRatio')::float AS "nplRatio", (summary->'par'->>'par30')::float AS par30
       FROM portfolio_snapshots WHERE month < $1 ORDER BY month DESC LIMIT 11`,
    [month],
  );
  return [...rows.reverse(), { month, nplRatio: current.nplRatio, par30: current.par.par30 }];
}
