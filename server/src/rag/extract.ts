import ExcelJS from 'exceljs';
import mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';

/**
 * Turn an uploaded file into Markdown-ish text for chunking. Headings become section
 * names for citations: PDF pages ("Page 3"), Word headings, Excel sheet names.
 */
export const SUPPORTED = /\.(txt|md|markdown|csv|pdf|docx|xlsx)$/i;

export async function extractDocumentText(filename: string, data: Buffer): Promise<string> {
  const ext = filename.toLowerCase().split('.').pop();
  switch (ext) {
    case 'pdf':
      return pdfText(data);
    case 'docx':
      return docxText(data);
    case 'xlsx':
      return xlsxText(data);
    default:
      return data.toString('utf8');
  }
}

async function pdfText(data: Buffer) {
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = (Array.isArray(text) ? text : [text]).map((t, i) => `## Page ${i + 1}\n\n${t.replace(/[ \t]+\n/g, '\n').trim()}`);
  const out = pages.join('\n\n');
  if (out.replace(/## Page \d+/g, '').trim().length < 20) {
    throw new Error('No text found in this PDF (it may be a scanned image; OCR is not supported yet)');
  }
  return out;
}

async function docxText(data: Buffer) {
  const { value: html } = await mammoth.convertToHtml({ buffer: data });
  return html
    .replace(/<h([1-6])[^>]*>(.*?)<\/h\1>/gi, (_, n, t) => `\n\n${'#'.repeat(Math.min(Number(n) + 1, 6))} ${t}\n\n`)
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(p|tr|table|ul|ol)>/gi, '\n\n')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function xlsxText(data: Buffer, maxRowsPerSheet = 2000) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as unknown as ArrayBuffer);
  const parts: string[] = [];
  wb.eachSheet((sheet) => {
    const lines: string[] = [];
    sheet.eachRow({ includeEmpty: false }, (row, n) => {
      if (n > maxRowsPerSheet) return;
      const cells = (row.values as unknown[]).slice(1).map(cellText);
      if (cells.some((c) => c)) lines.push(cells.join(' | '));
    });
    // Each block of rows stays under its sheet heading so citations name the sheet.
    const blocks: string[] = [];
    for (let i = 0; i < lines.length; i += 40) blocks.push(lines.slice(i, i + 40).join('\n'));
    if (blocks.length) parts.push(`## Sheet: ${sheet.name}\n\n${blocks.join('\n\n')}`);
  });
  return parts.join('\n\n');
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('result' in o) return cellText(o.result); // formula
    if ('text' in o) return String(o.text); // hyperlink
    if (Array.isArray(o.richText)) return (o.richText as Array<{ text: string }>).map((r) => r.text).join('');
    return '';
  }
  return String(v).replace(/\s+/g, ' ').trim();
}
