import { toNumber } from './arrears.js';

/**
 * Salary-deduction reconciliation: what each loan should have had deducted this month (from the
 * loan export) against what the employer / Angkasa file says was deducted. Files are read in memory
 * and never stored. The exception list goes back only to the person who uploaded it.
 */
const PATTERNS = {
  account: /\b(account|acc(t|ount)?[\s_.-]*no|akaun|loan[\s_-]*(no|id|number)|contract[\s_-]*no|no[\s_.-]*akaun|rujukan|reference|ref[\s_.-]*no)\b/i,
  ic: /\b(ic|nric|mykad|k\/?p|kad[\s_-]*pengenalan|identity|id[\s_-]*no)\b/i,
  salaryNo: /\b(salary[\s_-]*no|no[\s_.-]*gaji|payroll[\s_-]*(no|id)|employee[\s_-]*(no|id)|staff[\s_-]*(no|id)|no[\s_.-]*pekerja)\b/i,
  name: /\b(name|nama)\b/i,
  expected: /\b(instal+ment|ansuran|monthly[\s_-]*(payment|repayment|amount)|expected|jadual|scheduled|bayaran[\s_-]*bulanan)\b/i,
  deducted: /\b(deduct\w*|potongan|amount[\s_-]*(paid|received|deducted)|amaun|received|dibayar|jumlah)\b/i,
} as const;
type Col = keyof typeof PATTERNS;

export function detectDeductionColumns(headers: string[], want: Col[]): Partial<Record<Col, string>> {
  const found: Partial<Record<Col, string>> = {};
  for (const key of want) {
    const h = headers.find((x) => PATTERNS[key].test(x) && !Object.values(found).includes(x));
    if (h) found[key] = h;
  }
  return found;
}

/** Keys are compared without spaces, dashes and case ("880101-14-5555" = "880101145555"). */
export const normKey = (s: string) => s.replace(/[\s-]/g, '').toUpperCase();

export type ExceptionKind = 'missing' | 'short' | 'over' | 'unknown';
export interface DeductionException {
  kind: ExceptionKind;
  key: string;
  name: string;
  expected: number;
  deducted: number;
  difference: number;
}

export interface ReconciliationResult {
  matchedOn: 'account' | 'ic' | 'salaryNo';
  loans: number;
  deductionRows: number;
  matched: number;
  counts: Record<ExceptionKind, number>;
  amounts: { expected: number; deducted: number; shortfall: number };
  exceptions: DeductionException[];
}

export function reconcileDeductions(
  expected: { headers: string[]; rows: string[][] },
  received: { headers: string[]; rows: string[][] },
  tolerance = 1, // RM; rounding differences are not exceptions
): ReconciliationResult {
  const eCols = detectDeductionColumns(expected.headers, ['account', 'ic', 'salaryNo', 'name', 'expected']);
  const rCols = detectDeductionColumns(received.headers, ['account', 'ic', 'salaryNo', 'name', 'deducted']);
  if (!eCols.expected) throw new Error('The loan file needs a monthly instalment column (e.g. "Instalment" or "Ansuran").');
  if (!rCols.deducted) throw new Error('The deduction file needs an amount column (e.g. "Amount deducted" or "Potongan").');
  const matchedOn = (['account', 'ic', 'salaryNo'] as const).find((k) => eCols[k] && rCols[k]);
  if (!matchedOn) throw new Error('The two files need a common column to match on: account number, IC number or salary number.');

  const col = (h: string[], name?: string) => (name ? h.indexOf(name) : -1);
  const eKey = col(expected.headers, eCols[matchedOn]);
  const eAmt = col(expected.headers, eCols.expected);
  const eName = col(expected.headers, eCols.name);
  const rKey = col(received.headers, rCols[matchedOn]);
  const rAmt = col(received.headers, rCols.deducted);
  const rName = col(received.headers, rCols.name);

  // A person can have several deduction lines (and several loans): sum per key.
  const due = new Map<string, { amount: number; name: string }>();
  for (const r of expected.rows) {
    const key = normKey(r[eKey] ?? '');
    const amt = toNumber(r[eAmt] ?? '');
    if (!key || amt == null) continue;
    const cur = due.get(key) ?? { amount: 0, name: eName >= 0 ? (r[eName] ?? '').trim() : '' };
    cur.amount += amt;
    due.set(key, cur);
  }
  const got = new Map<string, { amount: number; name: string }>();
  let deductionRows = 0;
  for (const r of received.rows) {
    const key = normKey(r[rKey] ?? '');
    const amt = toNumber(r[rAmt] ?? '');
    if (!key || amt == null) continue;
    deductionRows++;
    const cur = got.get(key) ?? { amount: 0, name: rName >= 0 ? (r[rName] ?? '').trim() : '' };
    cur.amount += amt;
    got.set(key, cur);
  }

  const exceptions: DeductionException[] = [];
  let matched = 0;
  const round = (n: number) => Math.round(n * 100) / 100;
  for (const [key, d] of due) {
    const g = got.get(key);
    if (!g) {
      exceptions.push({ kind: 'missing', key, name: d.name, expected: round(d.amount), deducted: 0, difference: round(-d.amount) });
      continue;
    }
    const diff = g.amount - d.amount;
    if (Math.abs(diff) <= tolerance) matched++;
    else exceptions.push({ kind: diff < 0 ? 'short' : 'over', key, name: d.name || g.name, expected: round(d.amount), deducted: round(g.amount), difference: round(diff) });
  }
  for (const [key, g] of got) {
    if (!due.has(key)) exceptions.push({ kind: 'unknown', key, name: g.name, expected: 0, deducted: round(g.amount), difference: round(g.amount) });
  }
  const order: Record<ExceptionKind, number> = { missing: 0, short: 1, over: 2, unknown: 3 };
  exceptions.sort((a, b) => order[a.kind] - order[b.kind] || a.difference - b.difference);
  const counts = { missing: 0, short: 0, over: 0, unknown: 0 } as Record<ExceptionKind, number>;
  for (const e of exceptions) counts[e.kind]++;
  const sum = (m: Map<string, { amount: number }>) => round([...m.values()].reduce((s, x) => s + x.amount, 0));
  const shortfall = round(exceptions.filter((e) => e.kind === 'missing' || e.kind === 'short').reduce((s, e) => s - e.difference, 0));
  return { matchedOn, loans: due.size, deductionRows, matched, counts, amounts: { expected: sum(due), deducted: sum(got), shortfall }, exceptions };
}

/** Exceptions as CSV for the uploader to download (Excel opens it). */
export function exceptionsCsv(r: ReconciliationResult) {
  const esc = (s: string | number) => (/[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
  const head = ['Type', r.matchedOn === 'account' ? 'Account' : r.matchedOn === 'ic' ? 'IC' : 'Salary no', 'Name', 'Expected (RM)', 'Deducted (RM)', 'Difference (RM)'];
  const label: Record<ExceptionKind, string> = { missing: 'Not deducted', short: 'Short', over: 'Over', unknown: 'No matching loan' };
  return [head, ...r.exceptions.map((e) => [label[e.kind], e.key, e.name, e.expected.toFixed(2), e.deducted.toFixed(2), e.difference.toFixed(2)])]
    .map((row) => row.map(esc).join(','))
    .join('\r\n');
}
