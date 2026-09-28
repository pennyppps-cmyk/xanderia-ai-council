import ExcelJS from 'exceljs';
import { cleanArrearsMonths, cleanIc, msDate, MS_MONTHS, toIsoDate } from '../notis/masterlist.js';
import { parseCsv } from '../tools/arrears.js';

/**
 * Mail merge: every {{tag}} is mapped once to a column (or fixed text / the run date) with an
 * optional format; each row is then filled directly from the data. No AI per row: instant for a
 * whole batch, and the values are exactly what is in the file.
 */
export type Cell = string | number | null;
export type Row = Record<string, Cell>;

export const FORMATS = {
  none: 'As in the file',
  upper: 'UPPER CASE',
  title: 'Title Case',
  money: '1,234.50',
  money_rm: 'RM 1,234.50',
  integer: 'Whole number',
  date_ms: 'Date: 30 Jun 2026',
  date_en: 'Date: 30 June 2026',
  date_dmy: 'Date: 30/06/2026',
  ic: 'IC: 880101145555',
  ic_dash: 'IC: 880101-14-5555',
  months_ms: 'Months: Mei 2026, Jun 2026',
} as const;
export type Format = keyof typeof FORMATS;

export interface TagMap {
  source: 'column' | 'text' | 'run_date';
  column?: string;
  text?: string;
  format?: Format;
}
export type Mapping = Record<string, TagMap>;

export const OPS = {
  blank: 'is blank',
  not_blank: 'is not blank',
  equals: 'equals',
  not_equals: 'does not equal',
  contains: 'contains',
  gte: 'is at least',
  lte: 'is at most',
} as const;
export interface Filter {
  column: string;
  op: keyof typeof OPS;
  value?: string;
}

export interface EmailSettings {
  toColumn?: string;
  subject?: string;
  body?: string;
}

// ── Reading the data ─────────────────────────────────────────────────────────
function cellValue(v: unknown): Cell {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'object') {
    const o = v as { result?: unknown; text?: unknown; richText?: Array<{ text: string }>; error?: string };
    if (o.error) return null;
    if (o.result !== undefined) return cellValue(o.result);
    if (o.richText) return o.richText.map((t) => t.text).join('');
    if (typeof o.text === 'string') return o.text;
    if (o.text && typeof o.text === 'object') return cellValue(o.text);
    return null;
  }
  const s = String(v);
  return s === '' ? null : s;
}

export class SheetChoice extends Error {
  constructor(public sheets: string[], msg: string) {
    super(msg);
  }
}

const MAX_ROWS = 5000;

/** Reads a sheet (the named one, else the first with data) as headers + rows keyed by header. */
export async function readData(filename: string, data: Buffer, sheet?: string | null) {
  let table: Cell[][];
  let sheets: string[] = [];
  let used: string | null = null;
  if (/\.(csv|txt)$/i.test(filename)) {
    table = parseCsv(data.toString('utf8').replace(/^﻿/, '')).map((r) => r.map((c) => (c === '' ? null : c)));
  } else if (/\.xlsx$/i.test(filename)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(data as unknown as ArrayBuffer);
    sheets = wb.worksheets.map((w) => w.name);
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
    let ws = sheet ? wb.worksheets.find((w) => norm(w.name) === norm(sheet)) : undefined;
    if (sheet && !ws && sheets.length > 1) throw new SheetChoice(sheets, `Sheet "${sheet}" is not in this file. Choose the sheet with the data.`);
    ws ??= wb.worksheets.find((w) => w.actualRowCount > 1) ?? wb.worksheets[0];
    if (!ws) throw new Error('The workbook has no sheets');
    used = ws.name;
    table = [];
    ws.eachRow({ includeEmpty: false }, (r) => {
      const values = r.values as unknown[];
      table.push(Array.from({ length: Math.max(0, values.length - 1) }, (_, i) => cellValue(values[i + 1])));
    });
  } else {
    throw new Error('Upload the data as .xlsx or .csv');
  }
  if (table.length < 2) throw new Error('The sheet has no data rows');
  if (table.length - 1 > MAX_ROWS) throw new Error(`The sheet has more than ${MAX_ROWS.toLocaleString()} rows`);
  const width = Math.max(...table.map((r) => r.length));
  const headers: string[] = [];
  for (let i = 0; i < width; i++) {
    let h = String(table[0][i] ?? '').replace(/\s+/g, ' ').trim() || `Column ${i + 1}`;
    for (let n = 2; headers.includes(h); n++) h = `${String(table[0][i] ?? '').trim() || `Column ${i + 1}`} (${n})`;
    headers.push(h);
  }
  const rows: Array<{ rowNo: number; record: Row }> = [];
  table.slice(1).forEach((r, i) => {
    if (!r.some((v) => v != null && String(v).trim() !== '')) return;
    const record: Row = {};
    headers.forEach((h, c) => (record[h] = r[c] ?? null));
    rows.push({ rowNo: i + 2, record });
  });
  return { sheets, sheet: used, headers, rows };
}

// ── Mapping ──────────────────────────────────────────────────────────────────
const key = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
const ALIASES: Record<string, string[]> = {
  customername: ['name', 'nama', 'customer', 'nama pelanggan', 'client name'],
  name: ['customer name', 'nama'],
  ic: ['ic no', 'no kp', 'no. k/p', 'nric', 'ic number', 'mykad'],
  email: ['e-mail', 'emel', 'email address'],
  accountnumber: ['account no', 'account', 'no akaun', 'acc no'],
  address: ['alamat'],
  phone: ['phone no', 'tel', 'no telefon', 'mobile'],
};
function bigrams(s: string) {
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}
function similarity(a: string, b: string) {
  const x = bigrams(a);
  const y = bigrams(b);
  if (!x.size || !y.size) return 0;
  let n = 0;
  for (const g of x) if (y.has(g)) n++;
  return (2 * n) / (x.size + y.size);
}

/** Suggests a column (and a sensible format) for each tag by name: {{customername}} → "Customer Name". */
export function autoMap(tags: string[], headers: string[], current: Mapping = {}): Mapping {
  const out: Mapping = {};
  const byKey = new Map(headers.map((h) => [key(h), h] as const));
  for (const tag of tags) {
    const existing = current[tag];
    if (existing && (existing.source !== 'column' || (existing.column && headers.includes(existing.column)))) {
      out[tag] = existing;
      continue;
    }
    const k = key(tag);
    // Common short forms: account_no → accountnumber, acc_name → accountname, amt → amount.
    const long = k.replace(/^acc(?!ount)/, 'account').replace(/no$/, 'number').replace(/amt/, 'amount').replace(/^cust(?!omer)/, 'customer').replace(/tel$/, 'phone');
    let col = byKey.get(k) ?? byKey.get(long) ?? ALIASES[k]?.map((a) => byKey.get(key(a))).find(Boolean);
    // A bare {{date}} / {{tarikh}} is the letter date unless a column is called exactly that.
    if (!col && /^(date|tarikh|today|letterdate|noticedate|tarikhsurat)$/.test(k)) {
      out[tag] = { source: 'run_date', format: 'date_ms' };
      continue;
    }
    if (!col) {
      const scored = headers.map((h) => ({ h, s: Math.max(similarity(k, key(h)), key(h).includes(k) && k.length >= 4 ? 0.8 : 0, k.includes(key(h)) && key(h).length >= 4 ? 0.75 : 0) })).sort((a, b) => b.s - a.s);
      if (scored[0]?.s >= 0.72) col = scored[0].h;
    }
    out[tag] = col ? { source: 'column', column: col, format: guessFormat(tag, col) } : { source: 'column', format: 'none' };
  }
  return out;
}

function guessFormat(tag: string, column: string): Format {
  const k = `${key(tag)} ${key(column)}`;
  if (/(amount|jumlah|outstanding|installment|instalment|ansuran|balance|baki|rm)/.test(k)) return 'money';
  if (/(date|tarikh)/.test(k)) return 'date_ms';
  if (/(^|\s)(ic|nric|nokp|mykad)/.test(k)) return 'ic';
  if (/(monthinarrears|bulantertunggak)/.test(k)) return 'months_ms';
  return 'none';
}

// ── Values ───────────────────────────────────────────────────────────────────
const num = (v: Cell) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/RM/i, '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
};
const money = (n: number) => n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const EN_MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function formatValue(v: Cell, format: Format = 'none'): string {
  if (v == null || String(v).trim() === '') return '';
  const s = String(v).trim();
  switch (format) {
    case 'upper':
      return s.toUpperCase();
    case 'title':
      return s.toLowerCase().replace(/(^|[\s'-/(])\p{L}/gu, (m) => m.toUpperCase()).replace(/\b(Bin|Binti|A\/L|A\/P)\b/gi, (m) => m.toLowerCase() === 'a/l' || m.toLowerCase() === 'a/p' ? m.toUpperCase() : m.toLowerCase());
    case 'money': {
      const n = num(v);
      return n == null ? s : money(n);
    }
    case 'money_rm': {
      const n = num(v);
      return n == null ? s : `RM ${money(n)}`;
    }
    case 'integer': {
      const n = num(v);
      return n == null ? s : String(Math.round(n));
    }
    case 'date_ms':
    case 'date_en':
    case 'date_dmy': {
      const iso = toIsoDate(typeof v === 'number' ? v : s);
      if (!iso) return s;
      const [y, m, d] = iso.split('-').map(Number);
      if (format === 'date_ms') return msDate(iso);
      if (format === 'date_en') return `${d} ${EN_MONTHS[m]} ${y}`;
      return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
    }
    case 'ic':
    case 'ic_dash': {
      const ic = cleanIc(v);
      return format === 'ic_dash' && ic.length === 12 ? `${ic.slice(0, 6)}-${ic.slice(6, 8)}-${ic.slice(8)}` : ic;
    }
    case 'months_ms': {
      const m = cleanArrearsMonths(s);
      return m.text || s;
    }
    default:
      return typeof v === 'number' && !Number.isInteger(v) ? String(Math.round(v * 100) / 100) : s;
  }
}

/** Values for every tag of one row, plus which tags came out blank. */
export function valuesFor(record: Row, tags: string[], mapping: Mapping, runDate: string) {
  const values: Record<string, string> = {};
  const blank: string[] = [];
  for (const tag of tags) {
    const m = mapping[tag];
    let v = '';
    if (!m || (m.source === 'column' && !m.column)) v = '';
    else if (m.source === 'text') v = m.text ?? '';
    else if (m.source === 'run_date') v = formatValue(runDate, m.format && m.format.startsWith('date') ? m.format : 'date_ms');
    else v = formatValue(record[m.column!] ?? null, m.format);
    values[tag] = v;
    if (!v.trim()) blank.push(tag);
  }
  return { values, blank };
}

/** Fills {{tags}} in plain text (email subject/body, file names). */
export function fillText(text: string, values: Record<string, string>) {
  return text.replace(/\{\{\s*([A-Za-z0-9_][A-Za-z0-9_.-]*)\s*\}\}/g, (_m, t: string) => values[t.trim()] ?? '');
}

export function passes(record: Row, filters: Filter[]): boolean {
  return filters.every((f) => {
    const raw = record[f.column];
    const s = raw == null ? '' : String(raw).trim();
    const want = (f.value ?? '').trim();
    switch (f.op) {
      case 'blank':
        return s === '';
      case 'not_blank':
        return s !== '';
      case 'equals':
        return s.toLowerCase() === want.toLowerCase();
      case 'not_equals':
        return s.toLowerCase() !== want.toLowerCase();
      case 'contains':
        return s.toLowerCase().includes(want.toLowerCase());
      case 'gte':
      case 'lte': {
        const a = num(raw);
        const b = num(want);
        if (a == null || b == null) return false;
        return f.op === 'gte' ? a >= b : a <= b;
      }
      default:
        return true;
    }
  });
}

export function cleanEmailValue(v: Cell): string | null {
  const e = String(v ?? '').trim().replace(/^mailto:/i, '').replace(/\s+/g, '');
  return /^[^@\s,;]+@[^@\s,;]+\.[A-Za-z]{2,}$/.test(e) ? e.toLowerCase() : null;
}

export function safeFileName(s: string) {
  return s.replace(/[\\/:*?"<>|\r\n]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'document';
}

export { MS_MONTHS };
