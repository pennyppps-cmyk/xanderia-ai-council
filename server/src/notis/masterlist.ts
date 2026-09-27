import ExcelJS from 'exceljs';
import { parseCsv } from '../tools/arrears.js';

/**
 * Notis blast: reads the monthly Collections masterlist (the "MISS DEDUCTION EMAIL" sheet) and
 * checks every row before a letter is made. Same rules as the original notis-blast script
 * (hold column set by Finance → excluded; no valid email → skipped; no arrears months → skipped),
 * plus checks that stop a wrong letter going out (amounts that do not add up, unreadable months).
 */
export const DEFAULT_SHEET = 'MISS DEDUCTION EMAIL';
export const DEFAULT_HOLD_COLUMN = 'remarks Ain';
const MAX_ROWS = 5000;

export const FIELDS = {
  customer_name: ['customer name', 'nama', 'name'],
  ic: ['ic', 'no. k/p', 'no k/p', 'nric', 'ic no', 'no. kad pengenalan'],
  account_number: ['account number', 'account no', 'no. akaun', 'account'],
  address: ['address', 'alamat'],
  disbursement_amount: ['disbursement amount', 'jumlah pembiayaan', 'financing amount'],
  tenure: ['tenure', 'tempoh'],
  monthly_installment: ['monthly installment with interest', 'monthly instalment with interest', 'monthly installment', 'monthly instalment', 'ansuran bulanan'],
  outstanding_amount: ['outstanding amount', 'jumlah tertunggak', 'arrears amount'],
  overdue_month: ['overdue month', 'overdue months', 'bilangan bulan'],
  month_in_arrears: ['month in arrears', 'months in arrears', 'bulan tertunggak'],
  email: ['email', 'e-mail', 'emel', 'e-mel'],
  as_of_date: ['as of date', 'as at date', 'tarikh setakat'],
} as const;
export type Field = keyof typeof FIELDS;
const REQUIRED: Field[] = ['customer_name', 'account_number', 'email', 'month_in_arrears', 'outstanding_amount'];

export interface LetterData {
  customer_name: string;
  ic: string;
  account_number: string;
  address: string;
  disbursement_amount: number | null;
  tenure: number | null;
  monthly_installment: number | null;
  outstanding_amount: number | null;
  overdue_month: number | null;
  month_in_arrears: string; // cleaned, e.g. "Mei 2026, Jun 2026"
  as_of_date: string | null; // ISO date
}

export interface CheckedRow {
  rowNo: number; // spreadsheet row number (header = 1)
  state: 'ready' | 'held' | 'no_email' | 'incomplete';
  email: string | null;
  data: LetterData;
  reasons: string[]; // why it will not be sent
  warnings: string[]; // sent, but check
}

export interface Masterlist {
  sheets: string[];
  sheet: string | null;
  columns: Partial<Record<Field, string>>;
  holdColumn: string | null;
  asOfDefault: string | null;
  rows: CheckedRow[];
}

export class SheetNotFound extends Error {
  constructor(public sheets: string[], wanted: string) {
    super(`Sheet "${wanted}" not found. Choose the sheet with the customer list.`);
  }
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

function cell(v: unknown): unknown {
  if (v == null) return null;
  if (v instanceof Date || typeof v !== 'object') return v;
  const o = v as { result?: unknown; text?: unknown; richText?: Array<{ text: string }>; hyperlink?: string };
  if (o.result !== undefined) return cell(o.result);
  if (o.richText) return o.richText.map((t) => t.text).join('');
  if (typeof o.text === 'string') return o.text;
  if (o.text && typeof o.text === 'object') return cell(o.text);
  return null;
}

/** Reads one sheet (xlsx) or the CSV as header + typed rows. */
export async function readSheet(filename: string, data: Buffer, sheet?: string) {
  if (/\.(csv|txt)$/i.test(filename)) {
    const t = parseCsv(data.toString('utf8').replace(/^﻿/, ''));
    return { sheets: [], sheet: null, headers: (t[0] ?? []).map((h) => h.trim()), rows: t.slice(1) as unknown[][] };
  }
  if (!/\.xlsx$/i.test(filename)) throw new Error('Upload the masterlist as .xlsx (or .csv)');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as unknown as ArrayBuffer);
  const sheets = wb.worksheets.map((w) => w.name);
  const wanted = sheet ?? DEFAULT_SHEET;
  const ws = wb.worksheets.find((w) => norm(w.name) === norm(wanted)) ?? (sheet ? undefined : wb.worksheets.length === 1 ? wb.worksheets[0] : undefined);
  if (!ws) throw new SheetNotFound(sheets, wanted);
  const table: unknown[][] = [];
  ws.eachRow({ includeEmpty: false }, (r) => {
    const values = r.values as unknown[];
    table.push(Array.from({ length: Math.max(0, values.length - 1) }, (_, i) => cell(values[i + 1])));
  });
  return { sheets, sheet: ws.name, headers: (table[0] ?? []).map((h) => String(h ?? '').trim()), rows: table.slice(1) };
}

// ── Value cleaning ───────────────────────────────────────────────────────────
const MONTHS: Record<string, number> = {
  jan: 1, januari: 1, january: 1, feb: 2, februari: 2, february: 2, mar: 3, mac: 3, march: 3, apr: 4, april: 4,
  may: 5, mei: 5, jun: 6, june: 6, jul: 7, julai: 7, july: 7, aug: 8, ogos: 8, ogo: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, okt: 10, oktober: 10, october: 10, nov: 11, november: 11, dec: 12, dis: 12, disember: 12, december: 12,
};
export const MS_MONTHS = ['', 'Januari', 'Februari', 'Mac', 'April', 'Mei', 'Jun', 'Julai', 'Ogos', 'September', 'Oktober', 'November', 'Disember'];

/** "NOV 25 DEC 25", "FEB 26. MAC 26", "JULY 26," → months in Malay; unreadable parts are reported. */
export function cleanArrearsMonths(raw: string): { text: string; count: number; unreadable: string[] } {
  const s = raw.trim();
  if (!s) return { text: '', count: 0, unreadable: [] };
  const found: string[] = [];
  const unreadable: string[] = [];
  const re = /([A-Za-z]+)\.?\s*[-/']?\s*(\d+)?/g;
  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = re.exec(s))) {
    const gap = s.slice(last, m.index).replace(/[\s,.;/&-]/g, '');
    if (gap) unreadable.push(gap);
    last = re.lastIndex;
    if (/^(dan|and)$/i.test(m[1]) && !m[2]) continue;
    const month = MONTHS[m[1].toLowerCase()];
    const yy = m[2];
    if (!month || !yy || (yy.length !== 2 && yy.length !== 4)) {
      unreadable.push(m[0].trim());
      continue;
    }
    found.push(`${MS_MONTHS[month]} ${yy.length === 2 ? `20${yy}` : yy}`);
  }
  const tail = s.slice(last).replace(/[\s,.;/&-]/g, '');
  if (tail) unreadable.push(tail);
  return { text: found.join(', '), count: found.length, unreadable };
}

export function cleanEmail(raw: unknown): string | null {
  const e = String(raw ?? '').trim().replace(/^mailto:/i, '').replace(/\s+/g, '');
  return /^[^@\s,;]+@[^@\s,;]+\.[A-Za-z]{2,}$/.test(e) ? e.toLowerCase() : null;
}

export function toNumber(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const n = Number(String(raw).replace(/RM/i, '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

/** Excel keeps IC numbers as numbers, which drops a leading zero (born 2000+). */
export function cleanIc(raw: unknown): string {
  if (raw == null || raw === '') return '';
  let d = typeof raw === 'number' ? String(Math.round(raw)) : String(raw).replace(/\D/g, '');
  if (d.length === 11) d = `0${d}`;
  return d;
}

export function toIsoDate(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw.toISOString().slice(0, 10);
  if (typeof raw === 'number' && raw > 20000 && raw < 80000) return new Date(Date.UTC(1899, 11, 30) + raw * 86400000).toISOString().slice(0, 10);
  const s = String(raw).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

export function msDate(iso: string | null): string {
  if (!iso) return '';
  const [y, mo, d] = iso.split('-').map(Number);
  return `${d} ${MS_MONTHS[mo]} ${y}`;
}

const text = (v: unknown) => (v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim());

// ── Checking ─────────────────────────────────────────────────────────────────
export function checkMasterlist(
  headers: string[],
  rows: unknown[][],
  opts: { holdColumn?: string; sheets?: string[]; sheet?: string | null } = {},
): Masterlist {
  if (rows.length > MAX_ROWS) throw new Error(`The sheet has more than ${MAX_ROWS} rows`);
  const idx = new Map(headers.map((h, i) => [norm(h), i] as const));
  const columns: Partial<Record<Field, string>> = {};
  const col: Partial<Record<Field, number>> = {};
  for (const [f, names] of Object.entries(FIELDS) as Array<[Field, readonly string[]]>) {
    for (const n of names) {
      if (idx.has(n)) {
        col[f] = idx.get(n)!;
        columns[f] = headers[col[f]!];
        break;
      }
    }
  }
  const missing = REQUIRED.filter((f) => col[f] === undefined);
  if (missing.length) {
    throw new Error(`The sheet is missing these columns: ${missing.map((f) => FIELDS[f][0]).join(', ')}. Found: ${headers.filter(Boolean).join(', ')}`);
  }
  const holdName = opts.holdColumn ?? DEFAULT_HOLD_COLUMN;
  const holdIdx = idx.get(norm(holdName));
  const get = (r: unknown[], f: Field) => (col[f] === undefined ? null : r[col[f]!] ?? null);

  // Rows with a blank AS OF DATE use the file's usual date (the letter says "setakat <date>").
  const asOfCounts = new Map<string, number>();
  for (const r of rows) {
    const d = toIsoDate(get(r, 'as_of_date'));
    if (d) asOfCounts.set(d, (asOfCounts.get(d) ?? 0) + 1);
  }
  const asOfDefault = [...asOfCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const out: CheckedRow[] = [];
  rows.forEach((r, i) => {
    if (!r.some((v) => text(v))) return; // blank line
    const name = text(get(r, 'customer_name'));
    const account = text(get(r, 'account_number'));
    if (!name && !account) return; // totals / notes rows
    const months = cleanArrearsMonths(text(get(r, 'month_in_arrears')));
    const rawAsOf = toIsoDate(get(r, 'as_of_date'));
    const data: LetterData = {
      customer_name: name,
      ic: cleanIc(get(r, 'ic')),
      account_number: account,
      address: text(get(r, 'address')),
      disbursement_amount: toNumber(get(r, 'disbursement_amount')),
      tenure: toNumber(get(r, 'tenure')),
      monthly_installment: toNumber(get(r, 'monthly_installment')),
      outstanding_amount: toNumber(get(r, 'outstanding_amount')),
      overdue_month: toNumber(get(r, 'overdue_month')),
      month_in_arrears: months.text,
      as_of_date: rawAsOf ?? asOfDefault,
    };
    const email = cleanEmail(get(r, 'email'));
    const reasons: string[] = [];
    const warnings: string[] = [];
    let state: CheckedRow['state'] = 'ready';

    const hold = holdIdx === undefined ? '' : text(r[holdIdx]);
    if (hold) {
      state = 'held';
      reasons.push(`Held by Finance (${headers[holdIdx!]}): ${hold.slice(0, 200)}`);
    }
    if (state === 'ready' && !email) {
      state = 'no_email';
      reasons.push(text(get(r, 'email')) ? `Email address is not valid: "${text(get(r, 'email')).slice(0, 80)}"` : 'No email address');
    }
    const incomplete: string[] = [];
    if (!name) incomplete.push('customer name is blank');
    if (!account) incomplete.push('account number is blank');
    if (!months.text) incomplete.push(text(get(r, 'month_in_arrears')) ? `months in arrears cannot be read ("${text(get(r, 'month_in_arrears'))}")` : 'no months in arrears on record');
    if (data.outstanding_amount == null || data.outstanding_amount <= 0) incomplete.push('amount in arrears is blank or zero');
    if (incomplete.length) {
      if (state === 'ready') state = 'incomplete';
      reasons.push(...incomplete.map((s) => s[0].toUpperCase() + s.slice(1)));
    }

    if (months.unreadable.length && months.text) warnings.push(`Part of the months in arrears could not be read: "${months.unreadable.join('", "')}". The letter lists: ${months.text}`);
    if (data.overdue_month != null && months.count && data.overdue_month !== months.count) {
      warnings.push(`Overdue months says ${data.overdue_month}, but ${months.count} month(s) are listed (${months.text})`);
    }
    if (data.overdue_month != null && data.overdue_month > 12) warnings.push(`${data.overdue_month} months overdue: check this figure`);
    if (data.monthly_installment && data.overdue_month && data.outstanding_amount != null) {
      const expected = Math.round(data.monthly_installment * data.overdue_month * 100) / 100;
      if (Math.abs(expected - data.outstanding_amount) > 1) {
        warnings.push(`Amount in arrears RM ${data.outstanding_amount.toFixed(2)} does not equal instalment × months (RM ${expected.toFixed(2)})`);
      }
    }
    if (!data.ic) warnings.push('IC number is blank');
    else if (data.ic.length !== 12) warnings.push(`IC number has ${data.ic.length} digits, not 12`);
    if (!data.address) warnings.push('Address is blank');
    if (!rawAsOf) warnings.push(data.as_of_date ? `AS OF DATE is blank: using ${msDate(data.as_of_date)}` : 'AS OF DATE is blank');
    out.push({ rowNo: i + 2, state, email, data, reasons, warnings });
  });

  // Same email on several rows (family members, or one customer with two accounts).
  const byEmail = new Map<string, CheckedRow[]>();
  for (const r of out) if (r.email) byEmail.set(r.email, [...(byEmail.get(r.email) ?? []), r]);
  for (const group of byEmail.values()) {
    if (group.length < 2) continue;
    for (const r of group) r.warnings.push(`Same email as row ${group.filter((g) => g !== r).map((g) => g.rowNo).join(', ')}`);
  }
  const byAccount = new Map<string, CheckedRow[]>();
  for (const r of out) if (r.data.account_number) byAccount.set(r.data.account_number, [...(byAccount.get(r.data.account_number) ?? []), r]);
  for (const group of byAccount.values()) {
    if (group.length < 2) continue;
    for (const r of group) r.warnings.push(`Account number also on row ${group.filter((g) => g !== r).map((g) => g.rowNo).join(', ')}: the customer would get two letters`);
  }

  return { sheets: opts.sheets ?? [], sheet: opts.sheet ?? null, columns, holdColumn: holdIdx === undefined ? null : headers[holdIdx], asOfDefault, rows: out };
}
