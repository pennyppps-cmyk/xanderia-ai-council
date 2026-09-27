import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { emailBody, outlookDraft, renderLetter, zip } from '../src/notis/letter.js';
import { checkMasterlist, cleanArrearsMonths, cleanIc, readSheet, SheetNotFound } from '../src/notis/masterlist.js';

const HEADERS = ['No', 'Account Number', 'Customer Name', 'IC', 'ADDRESS', 'Disbursement Amount', 'Tenure', 'Monthly Installment', 'Monthly Installment with interest', 'Outstanding Amount', 'Overdue month', 'Month in Arrears', 'EMAIL', 'remarks Ain', 'AS OF DATE'];
const asOf = new Date(Date.UTC(2026, 5, 30));
// Synthetic customers only.
const ROWS: unknown[][] = [
  [1, 'ACC001', 'ALI BIN ABU', 880101145555, 'NO 1 JALAN SATU\n50000 KUALA LUMPUR', 20000, 60, 400, 450.5, 901, 2, 'MAY 26, JUN 26', ' Ali@Example.com ', null, asOf],
  [2, 'ACC002', 'SITI BINTI AHMAD', 10203145566, 'NO 2 JALAN DUA', 15000, 48, 350, 380, 380, 1, 'JUN 26,', 'siti@example.com', 'paid in full 12/7', asOf],
  [3, 'ACC003', 'RAVI A/L KUMAR', 900303147777, '', 10000, 36, 300, 320, 900, 3, 'NOV 25 DEC 25', 'no-email', null, asOf],
  [4, 'ACC004', 'MEI LING', 920404148888, 'NO 4', 12000, 36, 330, 350, 700, 2, '', 'mei@example.com', null, null],
  [5, 'ACC005', 'TAN AH KOW', 930505149999, 'NO 5', 12000, 36, 330, 350, 1050, 3, 'FEB 26. MAC 26 MAY 2', 'ali@example.com', null, null],
];

describe('notis masterlist checks', () => {
  it('applies the notis-blast rules and flags what would make a wrong letter', () => {
    const m = checkMasterlist(HEADERS, ROWS);
    expect(m.asOfDefault).toBe('2026-06-30');
    const [ali, siti, ravi, mei, tan] = m.rows;
    expect(ali).toMatchObject({ rowNo: 2, state: 'ready', email: 'ali@example.com' });
    expect(ali.data).toMatchObject({ month_in_arrears: 'Mei 2026, Jun 2026', monthly_installment: 450.5, outstanding_amount: 901, ic: '880101145555' });
    expect(siti.state).toBe('held');
    expect(siti.reasons[0]).toMatch(/Held by Finance \(remarks Ain\): paid in full/);
    expect(siti.data.ic).toBe('010203145566'); // leading zero restored
    expect(ravi.state).toBe('no_email');
    expect(ravi.data.month_in_arrears).toBe('November 2025, Disember 2025');
    expect(ravi.warnings.join(' ')).toMatch(/does not equal instalment/); // 900 vs 3 × 320
    expect(ravi.warnings.join(' ')).toMatch(/Overdue months says 3, but 2 month/);
    expect(ravi.warnings).toContain('Address is blank');
    expect(mei.state).toBe('incomplete');
    expect(mei.reasons).toContain('No months in arrears on record');
    expect(tan.state).toBe('ready');
    expect(tan.data.month_in_arrears).toBe('Februari 2026, Mac 2026');
    expect(tan.data.as_of_date).toBe('2026-06-30');
    expect(tan.warnings.join(' | ')).toMatch(/could not be read: "MAY 2"/);
    expect(tan.warnings.join(' | ')).toMatch(/AS OF DATE is blank: using 30 Jun 2026/);
    expect(tan.warnings.join(' | ')).toMatch(/Same email as row 2/);
  });

  it('cleans month lists', () => {
    expect(cleanArrearsMonths('JULY 26, SEPT 26, oct 26')).toEqual({ text: 'Julai 2026, September 2026, Oktober 2026', count: 3, unreadable: [] });
    expect(cleanArrearsMonths('Jan 2026 dan Feb 2026').text).toBe('Januari 2026, Februari 2026');
    expect(cleanIc('880101-14-5555')).toBe('880101145555');
  });

  it('names the missing columns', () => {
    expect(() => checkMasterlist(['Customer Name', 'EMAIL'], [['A', 'a@b.com']])).toThrow(/missing these columns: account number/);
  });

  it('reads the MISS DEDUCTION EMAIL sheet and lists sheets when it is not there', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('NPL Data').addRow(['x']);
    const ws = wb.addWorksheet('MISS DEDUCTION EMAIL');
    ws.addRow(HEADERS);
    ROWS.forEach((r) => ws.addRow(r));
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const s = await readSheet('list.xlsx', buf);
    expect(s.sheet).toBe('MISS DEDUCTION EMAIL');
    expect(checkMasterlist(s.headers, s.rows).rows.map((r) => r.state)).toEqual(['ready', 'held', 'no_email', 'incomplete', 'ready']);
    await expect(readSheet('list.xlsx', buf, 'Other')).rejects.toBeInstanceOf(SheetNotFound);
  });
});

describe('notis letter and drafts', () => {
  const d = checkMasterlist(HEADERS, ROWS).rows[0].data;
  it('renders the letter PDF', async () => {
    const pdf = await renderLetter(d, '27 September 2026');
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  });
  it('writes a covering email with the months and amount (fixed sentence)', () => {
    const e = emailBody(d);
    expect(e.subject).toBe('Makluman Tunggakan Bayaran Ansuran Bulanan Pembiayaan Peribadi');
    expect(e.text).toContain('tidak diterima bagi bulan Mei 2026, Jun 2026 (2 bulan). Maklumat ini');
    expect(e.html).toContain('RM 901.00');
  });
  it('builds an Outlook draft (.eml) with the letter attached, zipped', async () => {
    const eml = (await outlookDraft('ali@example.com', d, Buffer.from('%PDF-test'))).toString();
    expect(eml).toMatch(/^X-Unsent: 1/m);
    expect(eml).toMatch(/^To: ali@example.com/m);
    expect(eml).toContain('Notis_ALI_BIN_ABU_ACC001.pdf');
    const z = await JSZip.loadAsync(await zip([{ name: 'a.eml', data: eml }, { name: 'a.eml', data: 'x' }]));
    expect(Object.keys(z.files).sort()).toEqual(['a.eml', 'a_2.eml']);
  });
});
