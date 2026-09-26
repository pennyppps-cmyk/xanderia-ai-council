import ExcelJS from 'exceljs';
import { toNumber } from './arrears.js';

/**
 * Payslip affordability, from the payslip extractor's report (.xlsx). The report has one block per
 * payslip: header fields (type, month, name, salary no, IC), earnings lines (Pendapatan), deduction
 * lines (Potongan), totals, net pay and net pay %, and a "Match / Not Match" reconciliation column.
 * The file is read in memory and not stored; names and IC numbers never leave this module.
 */
export interface PayslipLine {
  code: string;
  name: string;
  amount: number;
}
export interface Payslip {
  type: string;
  month: string;
  gross: number;
  deductions: number;
  net: number;
  earnings: PayslipLine[];
  deductionLines: PayslipLine[];
  notMatched: number; // lines the extractor's own reconciliation marked "Not Match"
}

const text = (v: unknown): string => {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as { result?: unknown; text?: string; richText?: Array<{ text: string }> };
    if (o.result !== undefined) return text(o.result);
    if (o.richText) return o.richText.map((t) => t.text).join('');
    if (o.text) return o.text;
  }
  return String(v).trim();
};

/** Parse every payslip block in the extractor's report (left side: the payslip as extracted). */
export async function parsePayslipReport(data: Buffer): Promise<Payslip[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('The workbook is empty');
  const grid: string[][] = [];
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    grid[n - 1] = Array.from({ length: 12 }, (_, i) => text(row.getCell(i + 1).value));
  });
  const B = 1, C = 2, D = 3, E = 4, J = 9; // column indexes (A = 0)
  const slips: Payslip[] = [];
  let cur: Payslip | null = null;
  let section: 'earnings' | 'deductions' | null = null;
  const num = (s: string) => toNumber(s.replace(/%$/, '')) ?? 0;
  for (const row of grid) {
    if (!row) continue;
    const label = row[B].toLowerCase();
    if (label === 'payslip extraction result') {
      cur = { type: '', month: '', gross: 0, deductions: 0, net: 0, earnings: [], deductionLines: [], notMatched: 0 };
      slips.push(cur);
      section = null;
      continue;
    }
    if (!cur) continue;
    if (/not\s*match/i.test(row[J]) && !/match\s*\/\s*not/i.test(row[J])) cur.notMatched++;
    if (label === 'jenis payslip') cur.type = row[C];
    else if (label === 'bulan') cur.month = row[C];
    else if (label === 'pendapatan') section = 'earnings';
    else if (label === 'potongan') section = 'deductions';
    else if (label === 'jumlah pendapatan') { cur.gross = num(row[C]); section = null; }
    else if (label === 'jumlah potongan') { cur.deductions = num(row[C]); section = null; }
    else if (label === 'gaji bersih') cur.net = num(row[C]);
    // Line items: code in C, description in D, amount in E (the first row under a heading is the column header).
    if (section && /^\d{3,5}$/.test(row[C])) {
      const line = { code: row[C], name: row[D], amount: num(row[E]) };
      (section === 'earnings' ? cur.earnings : cur.deductionLines).push(line);
    }
  }
  const valid = slips.filter((s) => s.gross > 0);
  if (!valid.length) throw new Error('No payslip found. Upload the "Payslip Extraction Result" file from the payslip extractor.');
  for (const s of valid) {
    if (!s.deductions) s.deductions = s.deductionLines.reduce((n, l) => n + l.amount, 0);
    if (!s.net) s.net = s.gross - s.deductions;
  }
  return valid;
}

/** Existing financing among the deductions (cooperatives, banks, other lenders), by description. */
const FINANCING = /\b(pinjaman|pembiayaan|koperasi|koop|bank|kredit|loan|ansuran|angkasa|kereta|perumahan|rumah|lppsa|mara|ptptn|financing|bhd)\b/i;
/** Statutory deductions (not debt). */
const STATUTORY = /\b(kwsp|epf|perkeso|socso|pcb|cukai|tax|zakat|pencen|pension|eis|sip)\b/i;

export interface AffordabilityInput {
  instalment: number; // proposed new monthly instalment (RM)
  maxDeductionPct?: number; // total deductions may not exceed this share of gross pay (default 60%)
  minNet?: number; // and net pay must stay at or above this (RM, default 0 = no floor)
}

export function assessAffordability(slips: Payslip[], input: AffordabilityInput) {
  const maxPct = (input.maxDeductionPct ?? 60) / 100;
  const minNet = input.minNet ?? 0;
  const months = slips.map((s) => {
    const financing = s.deductionLines.filter((l) => FINANCING.test(l.name) && !STATUTORY.test(l.name));
    const after = s.deductions + input.instalment;
    return {
      month: s.month || '(month not read)',
      type: s.type,
      gross: s.gross,
      deductions: s.deductions,
      net: s.net,
      netPct: s.gross ? s.net / s.gross : 0,
      existingFinancing: financing.reduce((n, l) => n + l.amount, 0),
      financingLines: financing.map((l) => `${l.code} ${l.name}`.trim()),
      deductionPctAfter: s.gross ? after / s.gross : 1,
      netAfter: s.net - input.instalment,
      notMatched: s.notMatched,
    };
  });
  // Use the weakest month: affordability must hold every month, not on average.
  const worst = months.reduce((w, m) => (m.deductionPctAfter > w.deductionPctAfter ? m : w), months[0]);
  const headroom = worst.gross * maxPct - worst.deductions; // largest instalment the rule allows
  const flags: string[] = [];
  const grosses = months.map((m) => m.gross);
  if (months.length > 1 && (Math.max(...grosses) - Math.min(...grosses)) / Math.max(...grosses) > 0.1) {
    flags.push('Gross pay varies by more than 10% between months: check allowances or overtime that may not continue.');
  }
  if (months.some((m) => m.notMatched > 0)) flags.push('The payslip extractor marked some lines "Not Match": check the payslip against the original before approving.');
  if (months.length < 3) flags.push(`Only ${months.length} payslip(s) given; 3 recent months are usual.`);
  if (worst.existingFinancing > 0) flags.push(`Existing financing deductions of RM ${worst.existingFinancing.toFixed(2)} a month (${worst.financingLines.slice(0, 4).join('; ')}).`);
  const pass = worst.deductionPctAfter <= maxPct && worst.netAfter >= minNet;
  const borderline = pass && worst.deductionPctAfter > maxPct - 0.05;
  return {
    verdict: !pass ? ('fail' as const) : borderline ? ('borderline' as const) : ('pass' as const),
    rule: { maxDeductionPct: maxPct, minNet },
    instalment: input.instalment,
    maxAffordableInstalment: Math.max(0, Math.floor(headroom * 100) / 100),
    months,
    worstMonth: worst.month,
    flags,
  };
}

/** Figures only (no name, no IC), for the council or a credit memo draft. */
export function affordabilityMarkdown(a: ReturnType<typeof assessAffordability>, loan: { amount?: number; tenure?: number; rate?: number }) {
  const rm = (n: number) => `RM ${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  return [
    `**Affordability check** (applicant details withheld)`,
    loan.amount ? `Proposed financing: ${rm(loan.amount)}${loan.tenure ? ` over ${loan.tenure} months` : ''}${loan.rate ? ` at ${loan.rate}% a year` : ''}; monthly instalment ${rm(a.instalment)}.` : `Proposed monthly instalment: ${rm(a.instalment)}.`,
    `Rule: total deductions at most ${pct(a.rule.maxDeductionPct)} of gross pay${a.rule.minNet ? `, net pay at least ${rm(a.rule.minNet)}` : ''}. Result: **${a.verdict.toUpperCase()}**. Largest instalment the rule allows: ${rm(a.maxAffordableInstalment)}.`,
    '',
    '| Month | Gross | Deductions | Net | Deductions after new instalment | Net after |',
    '|---|---|---|---|---|---|',
    ...a.months.map((m) => `| ${m.month} | ${rm(m.gross)} | ${rm(m.deductions)} | ${rm(m.net)} | ${pct(m.deductionPctAfter)} | ${rm(m.netAfter)} |`),
    ...(a.flags.length ? ['', '**Flags**', ...a.flags.map((f) => `- ${f}`)] : []),
  ].join('\n');
}
