import { Document, Packer, Paragraph, TextRun } from 'docx';
import ExcelJS from 'exceljs';
import PizZip from 'pizzip';
import { describe, expect, it } from 'vitest';
import { extractTags, insertTag, previewHtml, renderDocx } from '../src/merge/docx.js';
import { autoMap, fillText, formatValue, passes, readData, valuesFor } from '../src/merge/mapping.js';

async function template() {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ children: [new TextRun('Tarikh: {{date}}')] }),
          // A tag split over two runs, as Word does after spellcheck or formatting changes.
          new Paragraph({ children: [new TextRun({ text: 'Tuan/Puan {{customer', bold: true }), new TextRun({ text: 'name}},', bold: true })] }),
          new Paragraph({ children: [new TextRun('Jumlah tertunggak: RM {{amount}} bagi akaun {{account_no}}.')] }),
          new Paragraph({ children: [new TextRun('Pegawai: Siti Aminah')] }),
        ],
      },
    ],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}
const text = (docx: Buffer) => new PizZip(docx).file('word/document.xml')!.asText().replace(/<[^>]+>/g, '');

describe('word templates', () => {
  it('finds tags (also when Word split one over runs) and fills them', async () => {
    const t = await template();
    expect(extractTags(t)).toEqual(['date', 'customername', 'amount', 'account_no']);
    const out = text(renderDocx(t, { date: '28 September 2026', customername: 'ALI BIN ABU', amount: '1,250.00', account_no: 'ACC001' }));
    expect(out).toContain('Tuan/Puan ALI BIN ABU,');
    expect(out).toContain('RM 1,250.00 bagi akaun ACC001.');
    expect(out).not.toContain('{{');
    expect(await previewHtml(t)).toContain('<mark data-tag="amount">{{amount}}</mark>');
  });

  it('turns selected text into a tag', async () => {
    const t = insertTag(await template(), 'Siti Aminah', 'officer');
    expect(extractTags(t)).toContain('officer');
    expect(text(renderDocx(t, { officer: 'Encik Rahman' }))).toContain('Pegawai: Encik Rahman');
    expect(() => insertTag(t, 'not in the document', 'x')).toThrow(/not found/);
    expect(() => insertTag(t, 'Pegawai', 'bad tag')).toThrow(/tag name/);
  });

  it('rejects a file that is not Word', () => {
    expect(() => extractTags(Buffer.from('hello'))).toThrow(/not a Word document|could not be read/);
  });
});

describe('mapping', () => {
  const headers = ['No', 'Customer Name', 'Account Number', 'Outstanding Amount', 'EMAIL', 'Disbursed Date', 'remarks Ain'];
  it('maps {{customername}} to "Customer Name" and picks formats', () => {
    const m = autoMap(['customername', 'account_no', 'amount', 'email', 'date', 'disbursed_date', 'unknown_thing'], headers);
    expect(m.customername).toEqual({ source: 'column', column: 'Customer Name', format: 'none' });
    expect(m.account_no.column).toBe('Account Number');
    expect(m.amount).toMatchObject({ column: 'Outstanding Amount', format: 'money' });
    expect(m.email.column).toBe('EMAIL');
    expect(m.date).toEqual({ source: 'run_date', format: 'date_ms' });
    expect(m.disbursed_date).toMatchObject({ column: 'Disbursed Date', format: 'date_ms' });
    expect(m.unknown_thing.column).toBeUndefined();
    // A saved choice is kept.
    expect(autoMap(['amount'], headers, { amount: { source: 'text', text: 'X' } }).amount).toEqual({ source: 'text', text: 'X' });
  });

  it('formats values', () => {
    expect(formatValue(1250.5, 'money_rm')).toBe('RM 1,250.50');
    expect(formatValue('2026-06-30', 'date_ms')).toBe('30 Jun 2026');
    expect(formatValue('2026-06-30', 'date_dmy')).toBe('30/06/2026');
    expect(formatValue(10203145566, 'ic_dash')).toBe('010203-14-5566');
    expect(formatValue('NOV 25 DEC 25', 'months_ms')).toBe('November 2025, Disember 2025');
    expect(formatValue('ali bin abu', 'title')).toBe('Ali bin Abu');
    expect(formatValue(null, 'money')).toBe('');
  });

  it('fills a row, reports blanks and applies filters', () => {
    const record = { 'Customer Name': 'ALI', 'Outstanding Amount': 901, 'remarks Ain': null, EMAIL: 'a@b.com' };
    const mapping = autoMap(['customername', 'amount', 'date', 'nothing'], Object.keys(record));
    const { values, blank } = valuesFor(record, ['customername', 'amount', 'date', 'nothing'], mapping, '2026-09-28');
    expect(values).toMatchObject({ customername: 'ALI', amount: '901.00', date: '28 September 2026' });
    expect(blank).toEqual(['nothing']);
    expect(fillText('Notis {{customername}} - {{amount}}', values)).toBe('Notis ALI - 901.00');
    expect(passes(record, [{ column: 'remarks Ain', op: 'blank' }, { column: 'Outstanding Amount', op: 'gte', value: '500' }])).toBe(true);
    expect(passes(record, [{ column: 'Outstanding Amount', op: 'lte', value: '500' }])).toBe(false);
  });

  it('reads the first sheet with data, or the named sheet', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Empty');
    const ws = wb.addWorksheet('Data');
    ws.addRow(['Name', 'Name', '', 'Date']);
    ws.addRow(['A', 'B', 'x', new Date(Date.UTC(2026, 5, 30))]);
    ws.addRow([]);
    const d = await readData('f.xlsx', Buffer.from(await wb.xlsx.writeBuffer()));
    expect(d.sheet).toBe('Data');
    expect(d.headers).toEqual(['Name', 'Name (2)', 'Column 3', 'Date']);
    expect(d.rows).toEqual([{ rowNo: 2, record: { Name: 'A', 'Name (2)': 'B', 'Column 3': 'x', Date: '2026-06-30' } }]);
  });
});
