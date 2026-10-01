import { config } from '../config.js';
import { toNumber } from '../tools/arrears.js';

/**
 * The company Document Extractor (doc-extractor on the GPU server) reads payslips, bank statements,
 * Angkasa statements and MyKad scans with OCR and cross-checks them (gross - deductions = net, wage
 * codes, line totals...). When a staff member attaches one of these to a question, the file is sent
 * there and the checked figures are put above the page text, so the council answers from numbers the
 * extractor has verified instead of re-reading a jumbled two-column PDF. Scans and photos, which have
 * no text layer, become readable too. Off when EXTRACTOR_URL is unset.
 */
export type ExtractorKind = 'payslip' | 'ic' | 'ape' | 'ape_pc' | 'base_rhb' | 'base_xanderia' | 'base_hongleong' | 'base_bankrakyat';

export interface ExtractorResult {
  status: 'completed' | 'review' | 'failed';
  confidence: number;
  fields: Record<string, unknown>;
  warnings: string[];
  raw_text?: string;
  error?: string | null;
}

export const IMAGE_EXT = /\.(jpe?g|png|tiff?|webp)$/i;
const EXTRACTABLE = /\.(pdf|jpe?g|png|tiff?|webp)$/i;

export const extractorEnabled = () => Boolean(config.EXTRACTOR_URL && config.EXTRACTOR_USER && config.EXTRACTOR_PASSWORD);

export const KIND_LABEL: Record<ExtractorKind, string> = {
  payslip: 'payslip',
  ic: 'MyKad / IC',
  ape: 'Angkasa Penyata (APE)',
  ape_pc: 'Angkasa Penyata (APE PC)',
  base_rhb: 'RHB bank statement',
  base_xanderia: 'Xanderia Berhad bank statement',
  base_hongleong: 'Hong Leong bank statement',
  base_bankrakyat: 'Bank Rakyat bank statement',
};

const APE_CODES = /\b(?:4070|410[1-9]|0301|9091)\s+[\d,]+\.\d{2}/g;
const APE_PC_CODES = /\b(?:412[0-6]|4131|4141)\s+[\d,]+\.\d{2}/g;

/**
 * Which extractor workspace fits this file, from its text (text PDFs) or its name (scans and photos).
 * Null means an ordinary document: the council reads its text as before.
 */
export function detectKind(filename: string, text: string): ExtractorKind | null {
  if (!EXTRACTABLE.test(filename)) return null;
  const t = text.toLowerCase();
  const name = filename.toLowerCase().replace(/[_~.-]+/g, ' ');
  if (t.replace(/## page \d+/g, '').trim().length >= 20) {
    if (/angkasa/.test(t) && /\b[cj]\s*\d{6,14}\b/.test(t)) {
      const pc = (text.match(APE_PC_CODES) ?? []).length;
      const ape = (text.match(APE_CODES) ?? []).length;
      if (pc || ape) return pc > ape ? 'ape_pc' : 'ape';
    }
    const statement = /statement|penyata|tempoh penyata|baki|balance/.test(t);
    if (statement && /rhb/.test(t) && /statement period|tempoh penyata/.test(t)) return 'base_rhb';
    if (statement && /hong\s*leong/.test(t)) return 'base_hongleong';
    if (statement && /bank\s*rakyat|bank kerjasama rakyat/.test(t)) return 'base_bankrakyat';
    if (statement && /xanderia berhad/.test(t) && /value date|entry date|tarikh nilai/.test(t)) return 'base_xanderia';
    if (/gaji\s*bersih|jumlah\s*pendapatan|jumlah\s*potongan|slip\s*gaji|payslip|pay\s*slip|net\s*pay|take\s*home/.test(t)) return 'payslip';
    if (/kad\s*pengenalan|mykad|identity\s*card/.test(t)) return 'ic';
    return null;
  }
  // No text layer: a scan or a photo. Bank and Angkasa extractors need a text PDF, so these go to OCR.
  if (/\b(ic|mykad|kp|nric|kad pengenalan|identity)\b/.test(name)) return 'ic';
  // The payslip workspace OCRs every page and returns the text, so it also reads any other scan.
  return 'payslip';
}

/** A logged-in session with the extractor, reused across uploads and renewed when it expires. */
let session: { cookie: string; csrf: string } | null = null;

function cookiesFrom(res: Response) {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : (res.headers.get('set-cookie') ?? '').split(/,(?=\s*\w+=)/);
  const jar: Record<string, string> = {};
  for (const c of list) {
    const m = /^\s*([^=;\s]+)=([^;]*)/.exec(c);
    if (m) jar[m[1]] = m[2];
  }
  return jar;
}

async function login(doFetch: typeof fetch, base: string) {
  const res = await doFetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: config.EXTRACTOR_USER, password: config.EXTRACTOR_PASSWORD }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Document Extractor login failed (${res.status})`);
  const jar = cookiesFrom(res);
  if (!jar.extractor_session || !jar.extractor_csrf) throw new Error('Document Extractor login gave no session');
  session = { cookie: `extractor_session=${jar.extractor_session}; extractor_csrf=${jar.extractor_csrf}`, csrf: jar.extractor_csrf };
  return session;
}

/** Forget the cached session (tests, or after the extractor's password changes). */
export function resetExtractorSession() {
  session = null;
}

/** Send one file to the extractor and wait for its checked result. */
export async function runExtraction(
  kind: ExtractorKind,
  filename: string,
  data: Buffer,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number; pollMs?: number } = {},
): Promise<ExtractorResult> {
  if (!extractorEnabled()) throw new Error('The Document Extractor is not configured');
  const doFetch = opts.fetchImpl ?? fetch;
  const base = config.EXTRACTOR_URL!.replace(/\/+$/, '');
  const call = async (path: string, init: RequestInit = {}, retry = true): Promise<Response> => {
    const s = session ?? (await login(doFetch, base));
    const res = await doFetch(`${base}${path}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), cookie: s.cookie, 'x-csrf-token': s.csrf },
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 401 && retry) {
      session = null;
      return call(path, init, false);
    }
    return res;
  };
  const form = () => {
    const f = new FormData();
    f.append('document_type', kind);
    f.append('files', new Blob([new Uint8Array(data)]), filename);
    return f;
  };
  // FormData bodies are consumed once, so a retry after re-login needs a fresh one.
  let created = await call('/api/jobs', { method: 'POST', body: form() }, false);
  if (created.status === 401) {
    session = null;
    created = await call('/api/jobs', { method: 'POST', body: form() }, false);
  }
  if (!created.ok) throw new Error(`Document Extractor refused the file (${created.status}): ${(await created.text()).slice(0, 200)}`);
  const { id } = (await created.json()) as { id: string };
  const deadline = Date.now() + (opts.timeoutMs ?? 120_000);
  const pollMs = opts.pollMs ?? 1000;
  for (;;) {
    const res = await call(`/api/jobs/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(`Document Extractor job check failed (${res.status})`);
    const job = (await res.json()) as { status: string; results?: ExtractorResult[] };
    if (job.status === 'completed' || job.status === 'failed') {
      const result = job.results?.[0];
      if (!result) throw new Error('Document Extractor returned no result');
      return result;
    }
    if (Date.now() > deadline) throw new Error('The Document Extractor is busy; try again in a few minutes');
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

// ---------- turning the result into text the council reads ----------

const num = (v: unknown): number | null => (typeof v === 'number' ? v : typeof v === 'string' ? toNumber(v) : null);
const rm = (v: unknown) => {
  const n = num(v);
  return n == null ? 'not found' : `RM ${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const str = (v: unknown) => (v == null || v === '' ? 'not found' : String(v));
const cell = (v: unknown) => (v == null ? '' : String(v).replace(/\s+/g, ' ').replace(/\|/g, '/').trim());

function header(kind: ExtractorKind, r: ExtractorResult) {
  const state =
    r.status === 'failed'
      ? `could not be read (${r.error ?? 'unknown error'})`
      : r.status === 'review'
        ? `read, but flagged for human review (confidence ${Math.round(r.confidence * 100)}%)`
        : `read and all checks passed (confidence ${Math.round(r.confidence * 100)}%)`;
  const lines = [
    `## Checked figures from the Document Extractor`,
    `The company Document Extractor read this file as a ${KIND_LABEL[kind]}: ${state}. Use these figures rather than re-reading numbers from the page text further down; the page text is there for anything not listed here.`,
  ];
  if (r.warnings?.length) lines.push(`Extractor warnings (tell the user about these and do not treat the affected figures as certain):\n${r.warnings.map((w) => `- ${w}`).join('\n')}`);
  return lines.join('\n\n');
}

function items(list: unknown) {
  const arr = Array.isArray(list) ? (list as Array<Record<string, unknown>>) : [];
  return arr.map((i) => `- ${cell(i.code)} ${cell(i.description)}: ${rm(i.amount)}`).join('\n');
}

function payslipBlock(f: Record<string, unknown>) {
  const gross = num(f.gross_pay);
  const net = num(f.net_pay);
  const ded = num(f.total_deductions);
  const share = gross && net != null ? `${((net / gross) * 100).toFixed(2)}%` : 'not available';
  const out = [
    `| Field | Value |\n|---|---|`,
    `| Name | ${cell(str(f.employee_name))} |`,
    `| Salary no. (No. Gaji) | ${cell(str(f.employee_id))} |`,
    `| IC (No. K/P) | ${cell(str(f.ic_number))} |`,
    `| Pay month (Bulan) | ${cell(str(f.pay_period))} |`,
    `| Basic salary (Gaji Pokok, 0001) | ${rm(f.basic_salary)} |`,
    `| Gross pay (Jumlah Pendapatan) | ${rm(gross)} |`,
    `| Total deductions (Jumlah Potongan) | ${rm(ded)} |`,
    `| Net pay (Gaji Bersih) | ${rm(net)} |`,
    `| Taxable income (Pendapatan Bercukai) | ${rm(f.taxable_income)} |`,
    `| % Peratus Gaji Bersih (as printed) | ${f.net_salary_percent == null ? 'not found' : `${f.net_salary_percent}%`} |`,
    `| Net ÷ gross (worked out) | ${share} |`,
    `| QR verification code | ${cell(str(f.verification_code))} |`,
    `| Pages in the file | ${cell(str(f.total_pages))} (the latest month is used when there are several) |`,
  ].join('\n');
  const parts = [out];
  const e = items(f.earnings);
  const d = items(f.deductions);
  const u = items(f.unclassified_items);
  if (e) parts.push(`Earnings (Pendapatan) lines:\n${e}`);
  if (d) parts.push(`Deduction (Potongan) lines:\n${d}`);
  if (u) parts.push(`Lines with a wage code not in the official register (check these):\n${u}`);
  return parts.join('\n\n');
}

function icBlock(f: Record<string, unknown>) {
  return [
    `| Field | Value |\n|---|---|`,
    `| Name | ${cell(str(f.name))} |`,
    `| IC number | ${cell(str(f.ic_number))} |`,
    `| Date of birth (from the IC) | ${cell(str(f.date_of_birth))} |`,
    `| Gender | ${cell(str(f.gender))} |`,
    `| Citizenship | ${cell(str(f.citizenship))} |`,
    `| Address | ${cell(str(f.address))} |`,
  ].join('\n');
}

type Row = Record<string, unknown>;
const findKey = (headers: string[], re: RegExp) => headers.find((h) => re.test(h));

/** Month key (YYYY-MM) from the date formats bank statements use. */
export function monthOf(v: unknown): string | null {
  const s = String(v ?? '').trim();
  let m = /^(\d{4})-(\d{2})-\d{2}/.exec(s);
  if (m) return `${m[1]}-${m[2]}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s);
  if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2].padStart(2, '0')}`;
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  m = /^(\d{1,2})\s*([a-z]{3})[a-z]*\s*(\d{2,4})/i.exec(s);
  if (m && months.includes(m[2].toLowerCase())) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${String(months.indexOf(m[2].toLowerCase()) + 1).padStart(2, '0')}`;
  return null;
}

const FLAG = /return|bounce|dishono|insufficient|reversal|revers|penalty|overdraft|chargeback|tolak|pulang/i;

function bankBlock(f: Record<string, unknown>) {
  const rows = (Array.isArray(f.records) ? f.records : []) as Row[];
  const headers = (Array.isArray(f.headers) ? f.headers : Object.keys(rows[0] ?? {})).map(String);
  const kDate = findKey(headers, /^(tarikh|date|entry date)$/i) ?? findKey(headers, /date|tarikh/i);
  const kDesc = findKey(headers, /description|keterangan|^transaction$/i);
  const kDebit = findKey(headers, /debit|withdrawal/i);
  const kCredit = findKey(headers, /credit|kredit|deposit/i);
  const kBal = findKey(headers, /balance|baki/i);
  const kAcct = findKey(headers, /account.?number|no\.? akaun|a\/c no/i);
  const kPeriod = findKey(headers, /period|tempoh/i);
  const debit = (r: Row) => (kDebit ? (num(r[kDebit]) ?? 0) : 0);
  const credit = (r: Row) => (kCredit ? (num(r[kCredit]) ?? 0) : 0);
  const desc = (r: Row) => cell(kDesc ? r[kDesc] : '');
  const totalCr = rows.reduce((s, r) => s + credit(r), 0);
  const totalDr = rows.reduce((s, r) => s + debit(r), 0);
  const first = rows[0];
  const last = rows[rows.length - 1];
  const out = [
    `| Item | Value |\n|---|---|`,
    `| Account | ${cell(kAcct && first ? first[kAcct] : 'not found')} |`,
    `| Statement period | ${cell(kPeriod && first ? first[kPeriod] : 'not found')} |`,
    `| Transactions | ${rows.length} |`,
    `| First / last date | ${cell(kDate && first ? first[kDate] : '')} to ${cell(kDate && last ? last[kDate] : '')} |`,
    `| Total money in (credits) | ${rm(totalCr)} |`,
    `| Total money out (debits) | ${rm(totalDr)} |`,
    `| Balance after first transaction | ${kBal && first ? rm(first[kBal]) : 'not found'} |`,
    `| Closing balance (last transaction) | ${kBal && last ? rm(last[kBal]) : 'not found'} |`,
  ].join('\n');
  const parts = [out];
  // Month by month: shows salary regularity and spending at a glance.
  if (kDate) {
    const byMonth = new Map<string, { cr: number; dr: number; n: number; low: number | null }>();
    for (const r of rows) {
      const m = monthOf(r[kDate]);
      if (!m) continue;
      const a = byMonth.get(m) ?? { cr: 0, dr: 0, n: 0, low: null };
      a.cr += credit(r);
      a.dr += debit(r);
      a.n += 1;
      const b = kBal ? num(r[kBal]) : null;
      if (b != null) a.low = a.low == null ? b : Math.min(a.low, b);
      byMonth.set(m, a);
    }
    if (byMonth.size) {
      parts.push(
        `Month by month:\n| Month | Transactions | Money in | Money out | Lowest balance |\n|---|---|---|---|---|\n` +
          [...byMonth.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([m, a]) => `| ${m} | ${a.n} | ${rm(a.cr)} | ${rm(a.dr)} | ${a.low == null ? '' : rm(a.low)} |`)
            .join('\n'),
      );
    }
  }
  const top = (pick: (r: Row) => number, label: string) => {
    const list = rows.filter((r) => pick(r) > 0).sort((a, b) => pick(b) - pick(a)).slice(0, 5);
    if (list.length) parts.push(`${label}:\n${list.map((r) => `- ${cell(kDate ? r[kDate] : '')} ${desc(r)}: ${rm(pick(r))}`).join('\n')}`);
  };
  top(credit, 'Largest money in');
  top(debit, 'Largest money out');
  // The same description credited in several months is usually salary or another regular income.
  const regular = new Map<string, Set<string>>();
  for (const r of rows) {
    if (credit(r) <= 0 || !kDate) continue;
    const key = desc(r).replace(/\d+/g, '').replace(/\s+/g, ' ').trim().slice(0, 40).toUpperCase();
    const m = monthOf(r[kDate]);
    if (!key || !m) continue;
    regular.set(key, (regular.get(key) ?? new Set()).add(m));
  }
  const repeats = [...regular.entries()].filter(([, ms]) => ms.size >= 2);
  if (repeats.length) parts.push(`Credits that repeat in several months (possible salary or regular income):\n${repeats.map(([k, ms]) => `- ${k} (${ms.size} months)`).join('\n')}`);
  const flagged = rows.filter((r) => FLAG.test(desc(r)));
  if (flagged.length) parts.push(`Lines that mention returns, reversals, penalties or bounced items:\n${flagged.slice(0, 15).map((r) => `- ${cell(kDate ? r[kDate] : '')} ${desc(r)}: out ${rm(debit(r))}, in ${rm(credit(r))}`).join('\n')}`);
  if (rows.length) {
    const cols = [kDate, kDesc, kDebit, kCredit, kBal].filter(Boolean) as string[];
    parts.push(`All transactions (${rows.length}):\n| ${cols.join(' | ')} |\n|${cols.map(() => '---').join('|')}|\n${rows.map((r) => `| ${cols.map((c) => cell(r[c])).join(' | ')} |`).join('\n')}`);
  }
  return parts.join('\n\n');
}

function apeBlock(f: Record<string, unknown>) {
  const rows = (Array.isArray(f.records) ? f.records : []) as Row[];
  const members = new Set(rows.map((r) => cell(r.NO_KP) || cell(r.NO_TENTERA) || cell(r.NAMA)));
  const byCode = new Map<string, { n: number; total: number }>();
  for (const r of rows) {
    const k = cell(r.KOD);
    const a = byCode.get(k) ?? { n: 0, total: 0 };
    a.n += 1;
    a.total += num(r.JUMLAH) ?? 0;
    byCode.set(k, a);
  }
  const parts = [
    `Members: ${members.size}; deduction lines: ${rows.length}; total of JUMLAH: ${rm(rows.reduce((s, r) => s + (num(r.JUMLAH) ?? 0), 0))}.`,
  ];
  if (byCode.size) parts.push(`By deduction code:\n${[...byCode.entries()].map(([k, a]) => `- ${k}: ${a.n} lines, ${rm(a.total)}`).join('\n')}`);
  if (rows.length) {
    parts.push(
      `All lines (JUMLAH = POKOK principal + FAEDAH profit; JUMLAH_TERIMAAN = total received for the member):\n| NAMA | NO_KP | NO_TENTERA | KOD | POKOK | FAEDAH | JUMLAH | TERIMAAN |\n|---|---|---|---|---|---|---|---|\n` +
        rows.map((r) => `| ${cell(r.NAMA)} | ${cell(r.NO_KP)} | ${cell(r.NO_TENTERA)} | ${cell(r.KOD)} | ${cell(r.JUMLAH_POKOK)} | ${cell(r.JUMLAH_FAEDAH)} | ${cell(r.JUMLAH)} | ${cell(r.JUMLAH_TERIMAAN)} |`).join('\n'),
    );
  }
  return parts.join('\n\n');
}

/** The page text the extractor read (OCR for scans; the latest-month page first for payslips). */
function extractorText(r: ExtractorResult) {
  const pages = r.fields?.page_content;
  if (Array.isArray(pages) && pages.length) {
    return (pages as Array<{ page: number; text: string }>).map((p) => `### Page ${p.page}\n\n${p.text}`).join('\n\n');
  }
  return r.raw_text ?? '';
}

/**
 * The attachment text the council reads: checked figures first (so a long statement is cut from the
 * end, never the figures), then the page text: the file's own text layer, or the extractor's OCR.
 */
export function composeAttachmentText(kind: ExtractorKind, r: ExtractorResult, ownText: string) {
  const f = r.fields ?? {};
  let body = '';
  if (r.status !== 'failed') {
    if (kind === 'payslip') {
      const core = ['employee_name', 'pay_period', 'gross_pay', 'net_pay'].filter((k) => f[k] != null).length;
      // A scan that is not a payslip (a letter, a form) only needed the OCR text.
      if (core === 0 && !ownText) return `## Document text (read by OCR)\n\n${extractorText(r)}`.trim();
      body = payslipBlock(f);
    } else if (kind === 'ic') body = icBlock(f);
    else if (kind === 'ape' || kind === 'ape_pc') body = apeBlock(f);
    else body = bankBlock(f);
  }
  const text = ownText || extractorText(r);
  return [header(kind, r), body, text ? `## Document text${ownText ? '' : ' (read by OCR)'}\n\n${text}` : ''].filter(Boolean).join('\n\n');
}
