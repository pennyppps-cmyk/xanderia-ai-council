import { BUCKETS, bucketFor, toNumber, type Bucket } from './arrears.js';

/**
 * Loan-book analytics from a loan export (one row per account). All figures are computed here,
 * exactly; the council only comments on them. Only aggregates leave this module.
 */
const PATTERNS = {
  account: /\b(account|acc(t|ount)?[\s_.-]*no|akaun|loan[\s_-]*(no|id|number)|contract[\s_-]*no|agreement[\s_-]*no|no[\s_.-]*akaun)\b/i,
  dpd: /\b(dpd|days?[\s_-]*(past[\s_-]*due|overdue|in[\s_-]*arrears?)|hari[\s_-]*tertunggak|ageing|aging)\b/i,
  balance: /\b(outstanding|balance|baki|o\/?s|principal[\s_-]*outstanding)\b/i,
  branch: /\b(branch|cawangan|region|state|negeri|office)\b/i,
  product: /\b(product|produk|scheme|facility[\s_-]*type)\b/i,
  disbursed: /\b(disburs\w*|drawdown|start[\s_-]*date|tarikh[\s_-]*(pengeluaran|mula|pembiayaan)|open(ed|ing)?[\s_-]*date|approval[\s_-]*date|booking[\s_-]*date)\b/i,
  restructured: /\b(restructur\w*|reschedul\w*|struktur[\s_-]*semula|R&R)\b/i,
  employer: /\b(employer|majikan|agency|agensi|ministry|kementerian|jabatan[\s_-]*kerja)\b/i,
} as const;
export type PortfolioColumn = keyof typeof PATTERNS;

export function detectPortfolioColumns(headers: string[]): Partial<Record<PortfolioColumn, string>> {
  const found: Partial<Record<PortfolioColumn, string>> = {};
  // Most specific first, so "Outstanding balance" is not taken as the DPD column and so on.
  for (const key of ['account', 'dpd', 'disbursed', 'restructured', 'employer', 'branch', 'product', 'balance'] as PortfolioColumn[]) {
    const h = headers.find((x) => PATTERNS[key].test(x) && !Object.values(found).includes(x));
    if (h) found[key] = h;
  }
  return found;
}

/** Dates as exported: ISO, dd/mm/yyyy, dd-mm-yyyy, or an Excel serial number. */
export function parseDate(s: string): Date | null {
  const t = s.trim();
  if (!t) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(t);
  if (m) {
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    return new Date(Date.UTC(y, +m[2] - 1, +m[1]));
  }
  if (/^\d{5}(\.\d+)?$/.test(t)) return new Date(Date.UTC(1899, 11, 30) + Math.round(+t) * 86_400_000);
  return null;
}

const yes = (s: string) => /^(y|yes|ya|true|1|r|restructured|rescheduled)$/i.test(s.trim());

interface Agg {
  accounts: number;
  balance: number;
  buckets: Record<Bucket, { accounts: number; balance: number }>;
  npl: { accounts: number; balance: number };
}
const emptyAgg = (): Agg => ({
  accounts: 0,
  balance: 0,
  buckets: Object.fromEntries(BUCKETS.map((b) => [b, { accounts: 0, balance: 0 }])) as Agg['buckets'],
  npl: { accounts: 0, balance: 0 },
});

export interface PortfolioOptions {
  /** Days past due at which a loan is non-performing (house rule; 90 by default). */
  nplDays?: number;
  /** Count restructured / rescheduled loans as NPL whatever their DPD (house rule; on by default). */
  restructuredIsNpl?: boolean;
}

export interface PortfolioSummary {
  rows: number;
  skipped: number;
  columns: Partial<Record<PortfolioColumn, string>>;
  options: Required<PortfolioOptions>;
  total: Agg;
  nplRatio: number; // balance-based
  nplRatioAccounts: number;
  par: { par30: number; par60: number; par90: number }; // share of balance at or beyond N days
  byBranch: Array<{ name: string } & Agg & { nplRatio: number }>;
  byProduct: Array<{ name: string } & Agg & { nplRatio: number }>;
  byEmployer: Array<{ name: string } & Agg & { nplRatio: number }>;
  vintage: Array<{ cohort: string; accounts: number; balance: number; npl: number; nplRatio: number; par30: number }>;
  rollRates: null | {
    matched: number;
    matrix: Record<Bucket, Partial<Record<Bucket, number>>>; // counts: last month's bucket → this month's
    rates: Array<{ from: Bucket; worse: number; same: number; better: number }>;
  };
}

type Row = { account: string; dpd: number; balance: number; branch: string; product: string; employer: string; disbursed: Date | null; restructured: boolean };

function readRows(headers: string[], rows: string[][], columns: Partial<Record<PortfolioColumn, string>>) {
  const ix = (k: PortfolioColumn) => (columns[k] ? headers.indexOf(columns[k]!) : -1);
  const [iAcc, iDpd, iBal, iBr, iPr, iEmp, iDis, iRes] = (['account', 'dpd', 'balance', 'branch', 'product', 'employer', 'disbursed', 'restructured'] as PortfolioColumn[]).map(ix);
  const out: Row[] = [];
  let skipped = 0;
  for (const r of rows) {
    const dpd = iDpd >= 0 ? toNumber(r[iDpd] ?? '') : null;
    if (dpd == null) {
      skipped++;
      continue;
    }
    out.push({
      account: iAcc >= 0 ? (r[iAcc] ?? '').trim() : '',
      dpd: Math.max(0, dpd),
      balance: iBal >= 0 ? (toNumber(r[iBal] ?? '') ?? 0) : 0,
      branch: iBr >= 0 ? (r[iBr] ?? '').trim() || '(blank)' : '',
      product: iPr >= 0 ? (r[iPr] ?? '').trim() || '(blank)' : '',
      employer: iEmp >= 0 ? (r[iEmp] ?? '').trim() || '(blank)' : '',
      disbursed: iDis >= 0 ? parseDate(r[iDis] ?? '') : null,
      restructured: iRes >= 0 ? yes(r[iRes] ?? '') : false,
    });
  }
  return { rows: out, skipped };
}

export function analysePortfolio(
  headers: string[],
  rows: string[][],
  opts: PortfolioOptions = {},
  previous?: { headers: string[]; rows: string[][] },
): PortfolioSummary {
  const columns = detectPortfolioColumns(headers);
  if (!columns.dpd) throw new Error('Could not find a days-past-due (DPD) column. Name it "DPD" or "Days past due".');
  const options = { nplDays: opts.nplDays ?? 90, restructuredIsNpl: opts.restructuredIsNpl ?? true };
  const { rows: loans, skipped } = readRows(headers, rows, columns);
  const isNpl = (l: Row) => l.dpd >= options.nplDays || (options.restructuredIsNpl && l.restructured);

  const total = emptyAgg();
  const groups = { branch: new Map<string, Agg>(), product: new Map<string, Agg>(), employer: new Map<string, Agg>() };
  const add = (a: Agg, l: Row) => {
    const b = bucketFor(l.dpd);
    a.accounts++;
    a.balance += l.balance;
    a.buckets[b].accounts++;
    a.buckets[b].balance += l.balance;
    if (isNpl(l)) {
      a.npl.accounts++;
      a.npl.balance += l.balance;
    }
  };
  const vintage = new Map<string, { accounts: number; balance: number; npl: number; par30: number }>();
  for (const l of loans) {
    add(total, l);
    for (const [key, map] of Object.entries(groups) as Array<[keyof typeof groups, Map<string, Agg>]>) {
      const name = l[key];
      if (!name) continue;
      if (!map.has(name)) map.set(name, emptyAgg());
      add(map.get(name)!, l);
    }
    if (l.disbursed) {
      const q = `${l.disbursed.getUTCFullYear()}-Q${Math.floor(l.disbursed.getUTCMonth() / 3) + 1}`;
      const v = vintage.get(q) ?? { accounts: 0, balance: 0, npl: 0, par30: 0 };
      v.accounts++;
      v.balance += l.balance;
      if (isNpl(l)) v.npl += l.balance;
      if (l.dpd >= 30) v.par30 += l.balance;
      vintage.set(q, v);
    }
  }
  const ratio = (a: number, b: number) => (b ? a / b : 0);
  const atLeast = (d: number) => loans.filter((l) => l.dpd >= d).reduce((s, l) => s + l.balance, 0);
  const groupList = (m: Map<string, Agg>) =>
    [...m.entries()]
      .map(([name, a]) => ({ name, ...a, nplRatio: ratio(a.npl.balance, a.balance) }))
      .sort((a, b) => b.balance - a.balance || b.accounts - a.accounts);

  let rollRates: PortfolioSummary['rollRates'] = null;
  if (previous) {
    const prevCols = detectPortfolioColumns(previous.headers);
    if (!prevCols.account || !columns.account) throw new Error('Roll rates need an account number column in both files.');
    const before = new Map(readRows(previous.headers, previous.rows, prevCols).rows.map((l) => [l.account, bucketFor(l.dpd)]));
    const matrix = Object.fromEntries(BUCKETS.map((b) => [b, {}])) as Record<Bucket, Partial<Record<Bucket, number>>>;
    let matched = 0;
    for (const l of loans) {
      const was = before.get(l.account);
      if (!was) continue;
      matched++;
      const now = bucketFor(l.dpd);
      matrix[was][now] = (matrix[was][now] ?? 0) + 1;
    }
    const rank = (b: Bucket) => BUCKETS.indexOf(b);
    const rates = BUCKETS.map((from) => {
      const row = matrix[from];
      const n = Object.values(row).reduce((s, x) => s + (x ?? 0), 0);
      const sum = (pred: (to: Bucket) => boolean) => BUCKETS.filter(pred).reduce((s, to) => s + (row[to] ?? 0), 0);
      return { from, worse: ratio(sum((to) => rank(to) > rank(from)), n), same: ratio(row[from] ?? 0, n), better: ratio(sum((to) => rank(to) < rank(from)), n) };
    });
    rollRates = { matched, matrix, rates };
  }

  return {
    rows: rows.length,
    skipped,
    columns,
    options,
    total,
    nplRatio: ratio(total.npl.balance, total.balance),
    nplRatioAccounts: ratio(total.npl.accounts, total.accounts),
    par: { par30: ratio(atLeast(30), total.balance), par60: ratio(atLeast(60), total.balance), par90: ratio(atLeast(90), total.balance) },
    byBranch: groupList(groups.branch),
    byProduct: groupList(groups.product),
    byEmployer: groupList(groups.employer),
    vintage: [...vintage.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cohort, v]) => ({ cohort, ...v, nplRatio: ratio(v.npl, v.balance), par30: ratio(v.par30, v.balance) })),
    rollRates,
  };
}

const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
const rm = (n: number) => `RM ${Math.round(n).toLocaleString('en-MY')}`;

/** Figures only, as markdown, for the council's commentary (no account-level data). */
export function portfolioMarkdown(s: PortfolioSummary, month: string, trend: Array<{ month: string; nplRatio: number }> = []) {
  const lines = [
    `**Loan portfolio, ${month}** (${s.total.accounts.toLocaleString()} accounts, ${rm(s.total.balance)} outstanding)`,
    `NPL definition: ${s.options.nplDays}+ days past due${s.options.restructuredIsNpl && s.columns.restructured ? ', restructured/rescheduled loans included' : ''}.`,
    '',
    `- NPL ratio: **${pct(s.nplRatio)}** of balance (${pct(s.nplRatioAccounts)} of accounts)`,
    `- PAR30 ${pct(s.par.par30)} · PAR60 ${pct(s.par.par60)} · PAR90 ${pct(s.par.par90)}`,
    trend.length > 1
      ? `- NPL trend: ${trend.map((t) => `${t.month} ${pct(t.nplRatio)}`).join(' → ')}`
      : '- NPL trend: none (no earlier month saved, so no month-on-month comparison is possible)',
    '',
    '| Bucket (DPD) | Accounts | Balance | % balance |',
    '|---|---|---|---|',
    ...BUCKETS.map((b) => `| ${b} | ${s.total.buckets[b].accounts.toLocaleString()} | ${rm(s.total.buckets[b].balance)} | ${pct(s.total.balance ? s.total.buckets[b].balance / s.total.balance : 0)} |`),
  ];
  const group = (title: string, list: PortfolioSummary['byBranch']) => {
    if (!list.length) return;
    lines.push('', `**${title}** (largest ${Math.min(8, list.length)})`, '', '| Name | Accounts | Balance | NPL ratio |', '|---|---|---|---|');
    for (const g of list.slice(0, 8)) lines.push(`| ${g.name} | ${g.accounts.toLocaleString()} | ${rm(g.balance)} | ${pct(g.nplRatio)} |`);
  };
  group('By branch', s.byBranch);
  group('By product', s.byProduct);
  group('By employer', s.byEmployer);
  if (s.vintage.length) {
    lines.push('', '**Vintage (by disbursement quarter)**', '', '| Cohort | Accounts | Balance | NPL ratio | PAR30 |', '|---|---|---|---|---|');
    for (const v of s.vintage.slice(-12)) lines.push(`| ${v.cohort} | ${v.accounts.toLocaleString()} | ${rm(v.balance)} | ${pct(v.nplRatio)} | ${pct(v.par30)} |`);
  }
  if (s.rollRates) {
    lines.push('', `**Roll rates vs last month** (${s.rollRates.matched.toLocaleString()} accounts matched)`, '', '| From bucket | Rolled worse | Stayed | Improved |', '|---|---|---|---|');
    for (const r of s.rollRates.rates) lines.push(`| ${r.from} | ${pct(r.worse)} | ${pct(r.same)} | ${pct(r.better)} |`);
  }
  return lines.join('\n');
}
