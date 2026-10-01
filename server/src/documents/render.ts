import PizZip from 'pizzip';

/**
 * Builds an official document on the company letterhead. The letterhead .docx is used as-is (its
 * header, logo, styles and fonts); only the body is replaced, the page is set to A4 and a footer
 * with the ownership notice and "Page X of Y" is added. The body is written as plain WordprocessingML
 * with direct formatting, so it looks the same whatever styles a new letterhead brings.
 */
export interface RenderInput {
  title: string;
  meta: Array<[string, string]>;
  numbered: boolean;
  sections: Array<{ heading: string; content: string }>;
  footer: string;
  pageLabel: { page: string; of: string };
}

const A4 = { w: 11906, h: 16838 };
const FOOTER_PART = 'word/footerXc.xml';
const FOOTER_RID = 'rIdXcFooter';
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const HEADING_COLOR = '0B5E55';
const RULE_COLOR = 'A6B8C2';

export const escXml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

// ── Runs and paragraphs ──────────────────────────────────────────────────────

interface RunFmt {
  b?: boolean;
  i?: boolean;
  sz?: number; // half-points
  color?: string;
  hl?: boolean;
  caps?: boolean;
}

function run(text: string, f: RunFmt = {}) {
  if (!text) return '';
  const pr =
    (f.b ? '<w:b/><w:bCs/>' : '') +
    (f.i ? '<w:i/><w:iCs/>' : '') +
    (f.caps ? '<w:caps/>' : '') +
    (f.color ? `<w:color w:val="${f.color}"/>` : '') +
    (f.sz ? `<w:sz w:val="${f.sz}"/><w:szCs w:val="${f.sz}"/>` : '') +
    (f.hl ? '<w:highlight w:val="yellow"/>' : '');
  return `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ''}<w:t xml:space="preserve">${escXml(text)}</w:t></w:r>`;
}

const tab = (f: RunFmt = {}) => `<w:r>${f.b ? '<w:rPr><w:b/><w:bCs/></w:rPr>' : ''}<w:tab/></w:r>`;

/** **bold**, *italic*, and [TBC: ...] placeholders highlighted so a reviewer cannot miss them. */
export function inline(text: string, base: RunFmt = {}) {
  const re = /(\*\*[^*]+\*\*|\[TBC:[^\]]*\]|\*[^*\s][^*]*\*)/gi;
  let out = '';
  let last = 0;
  for (const m of text.matchAll(re)) {
    out += run(text.slice(last, m.index), base);
    const t = m[0];
    if (t.startsWith('**')) out += inline(t.slice(2, -2), { ...base, b: true });
    else if (t.startsWith('[')) out += run(t, { ...base, hl: true });
    else out += run(t.slice(1, -1), { ...base, i: true });
    last = m.index! + t.length;
  }
  return out + run(text.slice(last), base);
}

interface ParaFmt {
  keepNext?: boolean;
  border?: boolean;
  tabs?: number[];
  before?: number;
  after?: number;
  left?: number;
  hanging?: number;
  jc?: 'left' | 'center' | 'right' | 'both';
  outline?: number;
}

function para(runs: string, f: ParaFmt = {}) {
  const pr =
    (f.keepNext ? '<w:keepNext/>' : '') +
    (f.border ? `<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="4" w:color="${RULE_COLOR}"/></w:pBdr>` : '') +
    (f.tabs?.length ? `<w:tabs>${f.tabs.map((p) => `<w:tab w:val="left" w:pos="${p}"/>`).join('')}</w:tabs>` : '') +
    `<w:spacing w:before="${f.before ?? 0}" w:after="${f.after ?? 120}"/>` +
    (f.left || f.hanging ? `<w:ind w:left="${f.left ?? 0}"${f.hanging ? ` w:hanging="${f.hanging}"` : ''}/>` : '') +
    (f.jc ? `<w:jc w:val="${f.jc}"/>` : '') +
    (f.outline !== undefined ? `<w:outlineLvl w:val="${f.outline}"/>` : '');
  return `<w:p><w:pPr>${pr}</w:pPr>${runs}</w:p>`;
}

// ── Tables ───────────────────────────────────────────────────────────────────

/** Rough width in twips of the text at 10 pt Arial, plus cell padding. */
const textTwips = (chars: number) => chars * 110 + 240;

/**
 * Column widths: every column gets at least its longest word (so "Likelihood" never breaks
 * mid-word), and the rest of the width goes to the columns with the most text.
 */
export function columnWidths(rows: string[][], cols: number, width: number) {
  const plain = (s: string) => s.replace(/\*\*|\[|\]/g, '');
  const col = (c: number) => rows.map((r) => plain(r[c] ?? ''));
  const minW = Array.from({ length: cols }, (_, c) => textTwips(Math.max(3, ...col(c).flatMap((t) => t.split(/\s+/).map((w) => (/^_+$/.test(w) ? 3 : w.length))))));
  const want = Array.from({ length: cols }, (_, c) => textTwips(Math.min(60, Math.max(3, ...col(c).map((t) => t.length)))));
  const need = minW.reduce((a, b) => a + b, 0);
  if (need >= width) return minW.map((w) => Math.floor((w * width) / need));
  // Share what is left in proportion to how much each column would like beyond its minimum.
  const extra = want.map((w, c) => Math.max(0, w - minW[c]));
  const extraTotal = extra.reduce((a, b) => a + b, 0) || 1;
  const widths = minW.map((w, c) => w + Math.floor(((width - need) * extra[c]) / extraTotal));
  widths[widths.indexOf(Math.max(...widths))] += width - widths.reduce((a, b) => a + b, 0);
  return widths;
}

function tableXml(rows: string[][], opts: { width: number; indent?: number; header?: boolean; borders?: boolean; widths?: number[]; sz?: number; ruleAfter?: boolean }) {
  const cols = Math.max(...rows.map((r) => r.length));
  const widths = opts.widths ?? columnWidths(rows, cols, opts.width);
  const border = opts.borders === false ? 'none' : 'single';
  const b = (side: string) => `<w:${side} w:val="${border}" w:sz="4" w:space="0" w:color="BFBFBF"/>`;
  const sz = opts.sz ?? 20;
  // A short table (a sign-off block, a small risk table) is kept on one page.
  const together = rows.length <= 8;
  const body = rows
    .map((r, ri) => {
      const isHead = opts.header && ri === 0;
      // A row of "____" cells is a signature row: blank boxes tall enough to sign in.
      const signature = r.length > 1 && r.slice(1).every((x) => /^_+$/.test(x.trim()));
      const cells = Array.from({ length: cols }, (_, c) => {
        const shade = isHead ? '<w:shd w:val="clear" w:color="auto" w:fill="E8F0EE"/>' : '';
        const text = signature && c > 0 ? '' : (r[c] ?? '');
        const p = para(inline(text, { sz, b: isHead || undefined }), { after: 0, keepNext: together && ri < rows.length - 1 });
        return `<w:tc><w:tcPr><w:tcW w:w="${widths[c]}" w:type="dxa"/>${shade}${signature ? '<w:vAlign w:val="bottom"/>' : ''}</w:tcPr>${p}</w:tc>`;
      }).join('');
      const trPr = '<w:cantSplit/>' + (signature ? '<w:trHeight w:val="900" w:hRule="atLeast"/>' : '') + (isHead ? '<w:tblHeader/>' : '');
      return `<w:tr><w:trPr>${trPr}</w:trPr>${cells}</w:tr>`;
    })
    .join('');
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="${opts.width}" w:type="dxa"/>` +
    (opts.indent ? `<w:tblInd w:w="${opts.indent}" w:type="dxa"/>` : '') +
    `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(b).join('')}</w:tblBorders>` +
    `<w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
    `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${body}</w:tbl>` +
    // A table must be followed by a paragraph; this one is the gap after it (or the rule under the details).
    para('', opts.ruleAfter ? { border: true, after: 240 } : { after: 120 })
  );
}

function parseTable(lines: string[]) {
  return lines
    .filter((l) => !/^\s*\|?\s*:?-{2,}/.test(l))
    .map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
}

// ── Markdown section body → paragraphs ───────────────────────────────────────

/**
 * One section's Markdown as WordprocessingML. In a numbered paper every paragraph gets the next
 * paragraph number (2.1, 2.2 ...) and lists sit under it; otherwise paragraphs are plain.
 */
export function sectionBody(md: string, opts: { numbered: boolean; sectionNo: number; textWidth: number }) {
  const out: string[] = [];
  const indent = opts.numbered ? 720 : 0;
  let paraNo = 0;
  const lines = md.replace(/\r/g, '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (line.trim().startsWith('|')) {
      const block: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) block.push(lines[i++]);
      i--;
      out.push(tableXml(parseTable(block), { width: opts.textWidth - indent, indent, header: true }));
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) continue;
    const bullet = /^(\s*)[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      const level = Math.min(Math.floor(bullet[1].length / 2), 2);
      const left = indent + 360 + level * 360;
      out.push(para(run('•') + tab() + inline(bullet[2]), { left, hanging: 360, tabs: [left], after: 60 }));
      continue;
    }
    const num = /^(\s*)(\d+|[a-z])[.)]\s+(.*)$/.exec(line);
    if (num) {
      const left = indent + 360 + Math.min(Math.floor(num[1].length / 2), 2) * 360;
      const label = /\d/.test(num[2]) ? `${num[2]}.` : `(${num[2]})`;
      out.push(para(run(label) + tab() + inline(num[3]), { left, hanging: 360, tabs: [left], after: 60 }));
      continue;
    }
    // Plain paragraph: join soft-wrapped lines.
    let text = line.trim();
    while (i + 1 < lines.length && lines[i + 1].trim() && !/^(\s*[-*•]\s|\s*(\d+|[a-z])[.)]\s|\s*\|)/.test(lines[i + 1])) text += ` ${lines[++i].trim()}`;
    if (opts.numbered) {
      paraNo++;
      out.push(para(run(`${opts.sectionNo}.${paraNo}`) + tab() + inline(text), { left: indent, hanging: indent, tabs: [indent], jc: 'both' }));
    } else {
      out.push(para(inline(text), { jc: 'both' }));
    }
  }
  return out.join('');
}

export function bodyXml(input: RenderInput, textWidth: number) {
  const parts: string[] = [];
  parts.push(para(run(input.title, { b: true, sz: 28 }), { jc: 'center', after: 240 }));
  parts.push(
    tableXml(
      input.meta.map(([k, v]) => [`**${k}**`, v]),
      { width: textWidth, borders: false, widths: [1500, textWidth - 1500], sz: 22, ruleAfter: true },
    ),
  );
  input.sections.forEach((s, i) => {
    const heading = input.numbered
      ? para(run(`${i + 1}.0`, { b: true }) + tab({ b: true }) + run(s.heading.toUpperCase(), { b: true }), {
          keepNext: true,
          tabs: [720],
          left: 720,
          hanging: 720,
          before: 240,
          after: 120,
          outline: 0,
        })
      : para(run(s.heading, { b: true, sz: 24, color: HEADING_COLOR }), { keepNext: true, before: 240, after: 100, outline: 0 });
    parts.push(heading, sectionBody(s.content, { numbered: input.numbered, sectionNo: i + 1, textWidth }));
  });
  return parts.join('');
}

// ── Footer ───────────────────────────────────────────────────────────────────

function field(instr: string, f: RunFmt) {
  const pr = `<w:rPr><w:color w:val="${f.color}"/><w:sz w:val="${f.sz}"/><w:szCs w:val="${f.sz}"/></w:rPr>`;
  return (
    `<w:r>${pr}<w:fldChar w:fldCharType="begin"/></w:r><w:r>${pr}<w:instrText xml:space="preserve"> ${instr} </w:instrText></w:r>` +
    `<w:r>${pr}<w:fldChar w:fldCharType="separate"/></w:r><w:r>${pr}<w:t>1</w:t></w:r><w:r>${pr}<w:fldChar w:fldCharType="end"/></w:r>`
  );
}

export function footerXml(text: string, label: { page: string; of: string }, textWidth: number) {
  const grey = { color: '7F7F7F', sz: 15 };
  const pageW = 2000;
  const cellPara = (runs: string, jc: 'left' | 'right') =>
    `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/><w:jc w:val="${jc}"/></w:pPr>${runs}</w:p>`;
  const noBorders = `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((s) => `<w:${s} w:val="none" w:sz="0" w:space="0" w:color="auto"/>`).join('')}</w:tblBorders>`;
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:ftr xmlns:w="${W_NS}" xmlns:r="${R_NS}">` +
    `<w:p><w:pPr><w:pBdr><w:top w:val="single" w:sz="4" w:space="1" w:color="${RULE_COLOR}"/></w:pBdr><w:spacing w:before="0" w:after="0"/></w:pPr></w:p>` +
    `<w:tbl><w:tblPr><w:tblW w:w="${textWidth}" w:type="dxa"/>${noBorders}<w:tblLayout w:type="fixed"/>` +
    `<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="${textWidth - pageW}"/><w:gridCol w:w="${pageW}"/></w:tblGrid><w:tr>` +
    `<w:tc><w:tcPr><w:tcW w:w="${textWidth - pageW}" w:type="dxa"/></w:tcPr>${cellPara(inline(text, grey), 'left')}</w:tc>` +
    `<w:tc><w:tcPr><w:tcW w:w="${pageW}" w:type="dxa"/><w:vAlign w:val="top"/></w:tcPr>${cellPara(
      run(`${label.page} `, grey) + field('PAGE', grey) + run(` ${label.of} `, grey) + field('NUMPAGES', grey),
      'right',
    )}</w:tc>` +
    `</w:tr></w:tbl><w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:p></w:ftr>`
  );
}

// ── Assembling the package ───────────────────────────────────────────────────

/** Throws a readable error when the file is not a usable Word document. */
export function checkLetterhead(docx: Buffer) {
  let zip: PizZip;
  try {
    zip = new PizZip(docx);
  } catch {
    throw new Error('That file is not a Word document (.docx)');
  }
  const doc = zip.file('word/document.xml')?.asText();
  if (!doc || !/<w:body>/.test(doc) || !/<w:sectPr[\s>]/.test(doc)) throw new Error('The letterhead could not be read: no document body found');
  return zip;
}

export function renderDocument(letterhead: Buffer, input: RenderInput): Buffer {
  const zip = checkLetterhead(letterhead);
  let doc = zip.file('word/document.xml')!.asText();

  // The last sectPr is the body's own (earlier ones belong to paragraphs of a multi-section letterhead).
  const sectStart = doc.lastIndexOf('<w:sectPr');
  const sectEnd = doc.indexOf('</w:sectPr>', sectStart) + '</w:sectPr>'.length;
  let sect = doc.slice(sectStart, sectEnd);

  const mar = /<w:pgMar\b[^>]*>/.exec(sect)?.[0] ?? '';
  const attr = (name: string, fallback: number) => Number(new RegExp(`w:${name}="(-?\\d+)"`).exec(mar)?.[1] ?? fallback);
  const textWidth = A4.w - attr('left', 1440) - attr('right', 1440) - attr('gutter', 0);

  sect = sect.replace(/<w:footerReference\b[^>]*\/>/g, '');
  sect = /<w:pgSz\b[^>]*\/>/.test(sect)
    ? sect.replace(/<w:pgSz\b[^>]*\/>/, `<w:pgSz w:w="${A4.w}" w:h="${A4.h}"/>`)
    : sect.replace(/(<w:pgMar\b)/, `<w:pgSz w:w="${A4.w}" w:h="${A4.h}"/>$1`);
  // Header and footer references come first in sectPr; a different first page needs its own reference.
  const refs =
    `<w:footerReference w:type="default" r:id="${FOOTER_RID}"/>` +
    (/<w:titlePg\b(?![^>]*w:val="(0|false)")/.test(sect) ? `<w:footerReference w:type="first" r:id="${FOOTER_RID}"/>` : '');
  const lastHeaderRef = [...sect.matchAll(/<w:headerReference\b[^>]*\/>/g)].pop();
  sect = lastHeaderRef
    ? sect.slice(0, lastHeaderRef.index! + lastHeaderRef[0].length) + refs + sect.slice(lastHeaderRef.index! + lastHeaderRef[0].length)
    : sect.replace(/^(<w:sectPr\b[^>]*>)/, `$1${refs}`);

  const bodyOpen = doc.indexOf('<w:body>') + '<w:body>'.length;
  doc = doc.slice(0, bodyOpen) + bodyXml(input, textWidth) + sect + doc.slice(sectEnd);
  if (!/xmlns:r=/.test(doc.slice(0, 4000))) doc = doc.replace('<w:document ', `<w:document xmlns:r="${R_NS}" `);
  zip.file('word/document.xml', doc);

  zip.file(FOOTER_PART, footerXml(input.footer, input.pageLabel, textWidth));
  const relsPath = 'word/_rels/document.xml.rels';
  let rels = zip.file(relsPath)?.asText() ?? '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  rels = rels.replace(new RegExp(`<Relationship [^>]*Id="${FOOTER_RID}"[^>]*/>`), '');
  rels = rels.replace(
    '</Relationships>',
    `<Relationship Id="${FOOTER_RID}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footerXc.xml"/></Relationships>`,
  );
  zip.file(relsPath, rels);
  let types = zip.file('[Content_Types].xml')!.asText();
  if (!types.includes('/word/footerXc.xml')) {
    types = types.replace(
      '</Types>',
      '<Override PartName="/word/footerXc.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>',
    );
  }
  zip.file('[Content_Types].xml', types);
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer;
}
