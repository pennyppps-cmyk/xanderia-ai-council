import ExcelJS from 'exceljs';

/**
 * Arrears file analysis: a collections export (CSV / XLSX, one row per account) → counts and
 * balances per days-past-due bucket, per branch and per product. The file is parsed in memory and
 * never stored; only the aggregates leave this module, so no customer rows reach the model.
 */

export const BUCKETS = ['Current', '1-30', '31-60', '61-90', '91-180', '181+'] as const;
export type Bucket = (typeof BUCKETS)[number];

export function bucketFor(dpd: number): Bucket {
  if (dpd <= 0) return 'Current';
  if (dpd <= 30) return '1-30';
  if (dpd <= 60) return '31-60';
  if (dpd <= 90) return '61-90';
  if (dpd <= 180) return '91-180';
  return '181+';
}

const COLUMN_PATTERNS = {
  dpd: /\b(dpd|days?[\s_-]*(past[\s_-]*due|overdue|in[\s_-]*arrears?)|hari[\s_-]*tertunggak|ageing|aging)\b/i,
  bucket: /\b(bucket|dpd[\s_-]*band|kategori)\b/i,
  balance: /\b(outstanding|balance|baki|o\/?s|arrears?[\s_-]*amount|amount[\s_-]*due|tunggakan|principal)\b/i,
  branch: /\b(branch|cawangan|region|state|negeri|office)\b/i,
  product: /\b(product|produk|scheme|facility[\s_-]*type)\b/i,
};
export type ColumnKey = keyof typeof COLUMN_PATTERNS;

export function detectColumns(headers: string[]): Partial<Record<ColumnKey, string>> {
  const found: Partial<Record<ColumnKey, string>> = {};
  for (const key of Object.keys(COLUMN_PATTERNS) as ColumnKey[]) {
    const h = headers.find((x) => COLUMN_PATTERNS[key].test(x) && !Object.values(found).includes(x));
    if (h) found[key] = h;
  }
  return found;
}

/** RFC-4180-ish CSV: quoted fields, doubled quotes, commas/newlines inside quotes; ; or tab delimiters. */
export function parseCsv(text: string): string[][] {
  const first = text.split('\n', 1)[0];
  const delim = [',', ';', '\t'].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) row.push(field), (field = '');
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field), (field = '');
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);
  return rows;
}

export const MAX_ROWS = 200_000;

export async function readTable(filename: string, data: Buffer): Promise<{ headers: string[]; rows: string[][] }> {
  let table: string[][];
  if (/\.xlsx$/i.test(filename)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(data as unknown as ArrayBuffer);
    const ws = wb.worksheets.find((w) => w.rowCount > 1) ?? wb.worksheets[0];
    if (!ws) throw new Error('The workbook has no sheets');
    table = [];
    ws.eachRow({ includeEmpty: false }, (r) => {
      const values = (r.values as unknown[]).slice(1);
      table.push(values.map((v) => cellText(v)));
    });
  } else if (/\.(csv|txt)$/i.test(filename)) {
    table = parseCsv(data.toString('utf8').replace(/^﻿/, ''));
  } else {
    throw new Error('Upload a .csv or .xlsx file');
  }
  if (table.length < 2) throw new Error('The file has no data rows');
  if (table.length - 1 > MAX_ROWS) throw new Error(`The file has more than ${MAX_ROWS.toLocaleString()} rows`);
  return { headers: table[0].map((h) => h.trim()), rows: table.slice(1) };
}

function cellText(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as { result?: unknown; text?: string; richText?: Array<{ text: string }> };
    if (o.result !== undefined) return cellText(o.result);
    if (o.richText) return o.richText.map((t) => t.text).join('');
    if (o.text) return o.text;
  }
  return String(v);
}

export function toNumber(s: string): number | null {
  const t = s.replace(/[,\s]|RM/gi, '').replace(/^\((.*)\)$/, '-$1');
  if (!t || !/^-?\d*\.?\d+$/.test(t)) return null;
  return Number(t);
}

interface Agg {
  accounts: number;
  balance: number;
  buckets: Record<Bucket, { accounts: number; balance: number }>;
}
const emptyAgg = (): Agg => ({
  accounts: 0,
  balance: 0,
  buckets: Object.fromEntries(BUCKETS.map((b) => [b, { accounts: 0, balance: 0 }])) as Agg['buckets'],
});

export interface ArrearsSummary {
  rows: number;
  skipped: number;
  columns: Partial<Record<ColumnKey, string>>;
  total: Agg;
  byBranch: Array<{ name: string } & Agg>;
  byProduct: Array<{ name: string } & Agg>;
}

function bucketFromLabel(s: string): Bucket | null {
  const t = s.toLowerCase().replace(/\s|days?|dpd|hari/g, '');
  if (!t) return null;
  if (/^(current|semasa|0)$/.test(t)) return 'Current';
  const n = /(\d+)/.exec(t);
  return n ? bucketFor(Number(n[1]) + (t.includes('+') || t.includes('>') ? 1 : 0)) : null;
}

export function analyseArrears(headers: string[], rows: string[][], columns = detectColumns(headers)): ArrearsSummary {
  if (!columns.dpd && !columns.bucket) {
    throw new Error('Could not find a days-past-due (DPD) or bucket column. Name it "DPD" or "Days past due".');
  }
  const idx = (k: ColumnKey) => (columns[k] ? headers.indexOf(columns[k]!) : -1);
  const [iDpd, iBucket, iBal, iBranch, iProduct] = (['dpd', 'bucket', 'balance', 'branch', 'product'] as ColumnKey[]).map(idx);
  const total = emptyAgg();
  const branches = new Map<string, Agg>();
  const products = new Map<string, Agg>();
  let skipped = 0;
  const add = (a: Agg, b: Bucket, bal: number) => {
    a.accounts++;
    a.balance += bal;
    a.buckets[b].accounts++;
    a.buckets[b].balance += bal;
  };
  for (const r of rows) {
    const dpd = iDpd >= 0 ? toNumber(r[iDpd] ?? '') : null;
    const bucket = dpd != null ? bucketFor(dpd) : iBucket >= 0 ? bucketFromLabel(r[iBucket] ?? '') : null;
    if (!bucket) {
      skipped++;
      continue;
    }
    const bal = iBal >= 0 ? (toNumber(r[iBal] ?? '') ?? 0) : 0;
    add(total, bucket, bal);
    if (iBranch >= 0) {
      const name = (r[iBranch] ?? '').trim() || '(blank)';
      if (!branches.has(name)) branches.set(name, emptyAgg());
      add(branches.get(name)!, bucket, bal);
    }
    if (iProduct >= 0) {
      const name = (r[iProduct] ?? '').trim() || '(blank)';
      if (!products.has(name)) products.set(name, emptyAgg());
      add(products.get(name)!, bucket, bal);
    }
  }
  const sorted = (m: Map<string, Agg>) =>
    [...m.entries()].map(([name, a]) => ({ name, ...a })).sort((a, b) => b.balance - a.balance || b.accounts - a.accounts);
  return { rows: rows.length, skipped, columns, total, byBranch: sorted(branches), byProduct: sorted(products) };
}

const rm = (n: number) => `RM ${Math.round(n).toLocaleString('en-MY')}`;
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : '-');
/** Share of the book 91+ days past due (the usual NPL cut-off). */
export const nplOf = (a: Agg, by: 'accounts' | 'balance' = 'balance') =>
  (a.buckets['91-180'][by] + a.buckets['181+'][by]) / (a[by] || 1);

/** Aggregates only, as markdown, for "Ask the council about this file". */
export function arrearsMarkdown(s: ArrearsSummary, top = 10): string {
  const hasBal = Boolean(s.columns.balance);
  const lines = [
    `**Arrears file summary** (${s.total.accounts.toLocaleString()} accounts${hasBal ? `, ${rm(s.total.balance)} outstanding` : ''}; aggregates only)`,
    '',
    `| Bucket (DPD) | Accounts | % accounts |${hasBal ? ' Balance | % balance |' : ''}`,
    `|---|---|---|${hasBal ? '---|---|' : ''}`,
    ...BUCKETS.map((b) => {
      const x = s.total.buckets[b];
      return `| ${b} | ${x.accounts.toLocaleString()} | ${pct(x.accounts, s.total.accounts)} |${hasBal ? ` ${rm(x.balance)} | ${pct(x.balance, s.total.balance)} |` : ''}`;
    }),
  ];
  const group = (title: string, list: ArrearsSummary['byBranch']) => {
    if (!list.length) return;
    lines.push('', `**${title}** (top ${Math.min(top, list.length)} of ${list.length} by ${hasBal ? 'balance' : 'accounts'})`, '');
    lines.push(`| ${title.replace(/^By /, '')} | Accounts | 1-90 DPD | 91+ DPD (NPL) | NPL % |`, '|---|---|---|---|---|');
    for (const g of list.slice(0, top)) {
      const early = g.buckets['1-30'].accounts + g.buckets['31-60'].accounts + g.buckets['61-90'].accounts;
      const npl = g.buckets['91-180'].accounts + g.buckets['181+'].accounts;
      lines.push(`| ${g.name} | ${g.accounts.toLocaleString()} | ${early.toLocaleString()} | ${npl.toLocaleString()} | ${(nplOf(g, hasBal ? 'balance' : 'accounts') * 100).toFixed(1)}% |`);
    }
  };
  group('By branch', s.byBranch);
  group('By product', s.byProduct);
  return lines.join('\n');
}
