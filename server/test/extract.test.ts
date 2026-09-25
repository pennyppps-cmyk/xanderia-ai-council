import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { describe, expect, it } from 'vitest';
import { chunkText } from '../src/rag/chunk.js';
import { extractDocumentText, SUPPORTED } from '../src/rag/extract.js';

function makePdf(pages: string[]): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument();
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    pages.forEach((p, i) => {
      if (i) doc.addPage();
      doc.text(p);
    });
    doc.end();
  });
}

describe('document extraction for the knowledge base', () => {
  it('accepts the Phase 2 formats', () => {
    for (const f of ['a.pdf', 'b.DOCX', 'c.xlsx', 'd.txt', 'e.md', 'f.csv']) expect(SUPPORTED.test(f)).toBe(true);
    for (const f of ['a.doc', 'b.xls', 'c.exe', 'd.png']) expect(SUPPORTED.test(f)).toBe(false);
  });

  it('extracts PDF text page by page, so citations can name the page', async () => {
    const pdf = await makePdf(['Collections SOP. Call customers on day 3 past due.', 'Escalate to field collection after 60 days past due.']);
    const text = await extractDocumentText('sop.pdf', pdf);
    expect(text).toContain('## Page 1');
    expect(text).toContain('## Page 2');
    expect(text).toMatch(/Escalate to field collection/);
    expect(chunkText(text).map((c) => c.section)).toEqual(['Page 1', 'Page 2']);
  });

  it('rejects PDFs without a text layer', async () => {
    await expect(extractDocumentText('scan.pdf', await makePdf(['']))).rejects.toThrow(/No text found/);
  });

  it('extracts Excel sheets as rows under a sheet heading', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Fees 2026');
    ws.addRow(['Product', 'Rate', 'Max amount']);
    ws.addRow(['Personal financing', 0.065, 50000]);
    ws.addRow(['Motorcycle', { formula: 'B2+0.01', result: 0.075 }, 15000]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const text = await extractDocumentText('fees.xlsx', buf);
    expect(text).toContain('## Sheet: Fees 2026');
    expect(text).toContain('Personal financing | 0.065 | 50000');
    expect(text).toContain('Motorcycle | 0.075 | 15000');
  });
});

describe('text cleanup', () => {
  it('removes NUL and control characters that PostgreSQL rejects, keeping tabs and newlines', async () => {
    const { cleanText } = await import('../src/rag/extract.js');
    expect(cleanText('a\u0000b\u0007c\td\ne')).toBe('ab c\td\ne');
  });
});
