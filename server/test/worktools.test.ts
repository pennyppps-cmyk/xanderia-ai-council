import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { readTable } from '../src/tools/arrears.js';
import { exceptionsCsv, reconcileDeductions } from '../src/tools/deductions.js';
import { assessAffordability, parsePayslipReport } from '../src/tools/payslip.js';
import { analysePortfolio, parseDate, portfolioMarkdown } from '../src/tools/portfolio.js';
import { renderPortfolioReport } from '../src/report/portfolioReport.js';

const csv = (s: string) => readTable('x.csv', Buffer.from(s));

describe('portfolio report', () => {
  const thisMonth = `Account No,Branch,Product,DPD,Outstanding,Disbursement Date,Restructured
A1,KL,PF,0,10000,2023-02-10,N
A2,KL,PF,45,20000,15/05/2023,N
A3,Ipoh,PF,120,30000,2024-01-20,N
A4,Ipoh,HP,10,40000,2024-02-01,Y
A5,Ipoh,HP,95,0,2024-03-01,N`;

  it('computes NPL (90+ days, restructured included), PAR and breakdowns exactly', async () => {
    const t = await csv(thisMonth);
    const s = analysePortfolio(t.headers, t.rows);
    expect(s.columns).toMatchObject({ account: 'Account No', dpd: 'DPD', balance: 'Outstanding', disbursed: 'Disbursement Date', restructured: 'Restructured' });
    expect(s.total.balance).toBe(100000);
    // NPL: A3 (120 DPD) + A4 (restructured) + A5 (95 DPD, zero balance)
    expect(s.total.npl.balance).toBe(70000);
    expect(s.nplRatio).toBeCloseTo(0.7);
    expect(s.par.par30).toBeCloseTo(0.5); // A2 + A3
    expect(s.par.par90).toBeCloseTo(0.3);
    expect(s.byBranch.map((b) => b.name)).toEqual(['Ipoh', 'KL']);
    expect(s.vintage.map((v) => v.cohort)).toEqual(['2023-Q1', '2023-Q2', '2024-Q1']);
    // House rule off: restructured loans only count when 90+ days
    expect(analysePortfolio(t.headers, t.rows, { restructuredIsNpl: false }).total.npl.balance).toBe(30000);
  });

  it('computes roll rates against last month by account', async () => {
    const now = await csv(thisMonth);
    const before = await csv('Account No,DPD,Outstanding\nA1,0,10000\nA2,10,20000\nA3,70,30000\nA4,0,40000');
    const s = analysePortfolio(now.headers, now.rows, {}, before);
    expect(s.rollRates!.matched).toBe(4);
    expect(s.rollRates!.matrix['1-30']).toEqual({ '31-60': 1 }); // A2 rolled worse
    const current = s.rollRates!.rates.find((r) => r.from === 'Current')!;
    expect(current.worse).toBeCloseTo(0.5); // A1 stayed, A4 moved to 1-30
    expect(portfolioMarkdown(s, '2026-09')).toContain('Roll rates vs last month');
  });

  it('reads the usual date formats', () => {
    expect(parseDate('2024-03-05')?.toISOString().slice(0, 10)).toBe('2024-03-05');
    expect(parseDate('05/03/2024')?.toISOString().slice(0, 10)).toBe('2024-03-05');
    expect(parseDate('45356')?.toISOString().slice(0, 10)).toBe('2024-03-05'); // Excel serial (1 Jan 2024 = 45292)
    expect(parseDate('')).toBeNull();
  });

  it('renders a PDF', async () => {
    const t = await csv(thisMonth);
    const s = analysePortfolio(t.headers, t.rows);
    const pdf = await renderPortfolioReport({ month: '2026-09', summary: s, commentary: '## Headline\nNPL is 70%.\n- Ipoh stands out', trend: [{ month: '2026-08', nplRatio: 0.6, par30: 0.5 }, { month: '2026-09', nplRatio: 0.7, par30: 0.5 }], generatedBy: 'Test' });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(5000);
  });
});

describe('salary-deduction reconciliation', () => {
  it('matches by IC regardless of formatting and lists every exception', async () => {
    const expected = await csv('Account,No. K/P,Nama,Ansuran\nA1,880101-14-5555,Ali,500\nA2,900202145566,Siti,300\nA3,910303-14-7777,Ravi,400\nA4,920404-14-8888,Mei,250');
    const received = await csv('No. K/P,Nama,Potongan\n880101145555,ALI,500.00\n900202-14-5566,SITI,150.00\n920404148888,MEI,300\n930505149999,TAN,200');
    const r = reconcileDeductions(expected, received);
    expect(r.matchedOn).toBe('ic');
    expect(r.matched).toBe(1); // Ali
    expect(r.counts).toEqual({ missing: 1, short: 1, over: 1, unknown: 1 });
    expect(r.amounts.shortfall).toBe(550); // Ravi 400 + Siti 150
    expect(r.exceptions[0]).toMatchObject({ kind: 'missing', name: 'Ravi', expected: 400 });
    expect(exceptionsCsv(r).split('\r\n')[0]).toBe('Type,IC,Name,Expected (RM),Deducted (RM),Difference (RM)');
  });

  it('explains what is missing', async () => {
    await expect(async () => reconcileDeductions(await csv('Account,Name\nA1,x'), await csv('Account,Potongan\nA1,5'))).rejects.toThrow(/instalment column/);
  });
});

/** A workbook laid out like the payslip extractor's "Payslip Extraction Result" report (synthetic figures). */
async function extractorReport(months: Array<{ month: string; gross: number; lines: Array<[string, string, number]>; notMatch?: boolean }>) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Report');
  let r = 1;
  const put = (cells: Record<string, string | number>) => {
    for (const [col, v] of Object.entries(cells)) ws.getCell(`${col}${r}`).value = v;
    r++;
  };
  for (const m of months) {
    const deductions = m.lines.reduce((n, l) => n + l[2], 0);
    put({ B: 'Payslip Extraction Result', J: 'Reconciliation Result' });
    put({ B: 'Jenis Payslip', C: 'Kerajaan', J: 'Match' });
    put({ B: 'Bulan', C: m.month, J: 'Match' });
    put({ B: 'Nama', C: 'PEMOHON', J: 'Match' });
    put({ B: 'No. Gaji', C: '12345', J: 'Match' });
    put({ B: 'No. K/P', C: '880101-14-5555', J: 'Match' });
    put({ B: 'Pendapatan', C: 'Kod', D: 'Keterangan', E: 'Amaun (RM)', J: 'Match' });
    put({ C: '0001', D: 'Gaji Pokok', E: m.gross.toFixed(2), J: 'Match' });
    put({ B: 'Jumlah Pendapatan', C: m.gross.toLocaleString('en-MY', { minimumFractionDigits: 2 }), J: 'Match' });
    put({ B: 'Potongan', C: 'Kod', D: 'Keterangan', E: 'Amaun (RM)', J: 'Match' });
    for (const [code, name, amt] of m.lines) put({ C: code, D: name, E: amt.toFixed(2), J: m.notMatch ? 'Not Match' : 'Match' });
    put({ B: 'Jumlah Potongan', C: deductions.toFixed(2), J: 'Match' });
    put({ B: 'Gaji Bersih', C: (m.gross - deductions).toFixed(2), J: 'Match' });
    put({ B: '% Peratus Gaji Bersih', C: `${(((m.gross - deductions) / m.gross) * 100).toFixed(1)}%`, J: 'Match' });
    r++;
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('payslip affordability', () => {
  it('parses the extractor report and applies the 60% deduction rule on the weakest month', async () => {
    const data = await extractorReport([
      { month: 'Julai 2026', gross: 5000, lines: [['4001', 'KWSP', 550], ['4002', 'Koperasi Pinjaman ABC', 1200]] },
      { month: 'Ogos 2026', gross: 5000, lines: [['4001', 'KWSP', 550], ['4002', 'Koperasi Pinjaman ABC', 1200], ['4003', 'Cukai PCB', 100]], notMatch: true },
    ]);
    const slips = await parsePayslipReport(data);
    expect(slips.map((s) => [s.month, s.gross, s.deductions, s.net])).toEqual([
      ['Julai 2026', 5000, 1750, 3250],
      ['Ogos 2026', 5000, 1850, 3150],
    ]);
    const a = assessAffordability(slips, { instalment: 1000 });
    expect(a.worstMonth).toBe('Ogos 2026');
    expect(a.months[1].deductionPctAfter).toBeCloseTo(0.57); // (1850 + 1000) / 5000
    expect(a.verdict).toBe('borderline'); // within 5 points of the 60% limit
    expect(a.maxAffordableInstalment).toBe(1150); // 60% of 5000 - 1850
    expect(a.flags.join(' ')).toMatch(/Not Match/);
    expect(a.flags.join(' ')).toMatch(/Existing financing deductions of RM 1200\.00/);
    expect(assessAffordability(slips, { instalment: 1500 }).verdict).toBe('fail');
    expect(assessAffordability(slips, { instalment: 300 }).verdict).toBe('pass');
  });

  it('rejects a file that is not the extractor report', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('x').getCell('A1').value = 'hello';
    await expect(parsePayslipReport(Buffer.from(await wb.xlsx.writeBuffer()))).rejects.toThrow(/No payslip found/);
  });
});
