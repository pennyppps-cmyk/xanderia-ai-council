import Docxtemplater from 'docxtemplater';
import mammoth from 'mammoth';
import PizZip from 'pizzip';

/**
 * Word templates with {{tags}} (the same convention as Nexus). docxtemplater joins a tag that Word
 * split across formatting runs, so a tag typed in Word works even with spellcheck marks.
 */
export const TAG_RE = /\{\{\s*([A-Za-z0-9_][A-Za-z0-9_.-]*)\s*\}\}/g;

function load(docx: Buffer) {
  const zip = new PizZip(docx);
  return new Docxtemplater(zip, {
    delimiters: { start: '{{', end: '}}' },
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => '',
  });
}

/** Tags in the document, in order of first appearance. Throws a readable error for a broken template. */
export function extractTags(docx: Buffer): string[] {
  let text: string;
  try {
    text = load(docx).getFullText();
  } catch (err) {
    throw new Error(templateError(err));
  }
  // Headers and footers can hold tags too.
  const zip = new PizZip(docx);
  for (const f of Object.keys(zip.files).filter((n) => /^word\/(header|footer)\d*\.xml$/.test(n))) {
    text += ' ' + zip.file(f)!.asText().replace(/<[^>]+>/g, '');
  }
  const seen = new Set<string>();
  for (const m of text.matchAll(TAG_RE)) seen.add(m[1].trim());
  return [...seen];
}

function templateError(err: unknown): string {
  const e = err as { properties?: { errors?: Array<{ properties?: { explanation?: string } }>; explanation?: string }; message?: string };
  const list = e.properties?.errors?.map((x) => x.properties?.explanation).filter(Boolean) ?? [];
  if (list.length) return `The template has a problem: ${list.slice(0, 3).join('; ')}`;
  if (/zip|end of central directory/i.test(e.message ?? '')) return 'That file is not a Word document (.docx)';
  return `The template could not be read: ${e.message ?? 'unknown error'}`;
}

export function renderDocx(docx: Buffer, values: Record<string, string>): Buffer {
  const doc = load(docx);
  try {
    doc.render(values);
  } catch (err) {
    throw new Error(templateError(err));
  }
  return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer;
}

/** Read-only HTML preview with every {{tag}} highlighted. */
export async function previewHtml(docx: Buffer): Promise<string> {
  const { value } = await mammoth.convertToHtml({ buffer: docx });
  return value.replace(TAG_RE, (_m, tag: string) => `<mark data-tag="${tag}">{{${tag}}}</mark>`);
}

const RUN = /<w:t(\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const encode = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Replaces the first occurrence of `text` in the document body with {{tag}}, keeping the formatting
 * of the text it replaces. When Word has split the text over several runs, the first run takes the
 * tag and the rest of the matched text is removed from the others.
 */
export function insertTag(docx: Buffer, text: string, tag: string): Buffer {
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(tag)) throw new Error('A tag name can use letters, numbers, _ . and - (no spaces)');
  const needle = text.trim();
  if (!needle) throw new Error('Select the text to replace first');
  const zip = new PizZip(docx);
  const file = zip.file('word/document.xml');
  if (!file) throw new Error('That file is not a Word document (.docx)');
  const xml = file.asText();
  const runs: Array<{ attrs: string; text: string; start: number; end: number; offset: number }> = [];
  let full = '';
  for (const m of xml.matchAll(RUN)) {
    const t = decode(m[2]);
    runs.push({ attrs: m[1] ?? '', text: t, start: m.index!, end: m.index! + m[0].length, offset: full.length });
    full += t;
  }
  const at = full.indexOf(needle);
  if (at === -1) throw new Error(`"${needle.slice(0, 60)}" was not found in the document text (it may be in a text box, header or table cell that Word stores separately)`);
  const stop = at + needle.length;
  const touched = runs.filter((r) => r.offset < stop && r.offset + r.text.length > at);
  let out = xml;
  // Edit from the last run backwards so earlier positions stay valid.
  for (let i = touched.length - 1; i >= 0; i--) {
    const r = touched[i];
    const from = Math.max(0, at - r.offset);
    const to = Math.min(r.text.length, stop - r.offset);
    const replaced = r.text.slice(0, from) + (i === 0 ? `{{${tag}}}` : '') + r.text.slice(to);
    const attrs = /xml:space=/.test(r.attrs) ? r.attrs : `${r.attrs} xml:space="preserve"`;
    out = out.slice(0, r.start) + `<w:t${attrs}>${encode(replaced)}</w:t>` + out.slice(r.end);
  }
  zip.file('word/document.xml', out);
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer;
}
