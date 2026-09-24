import { AlignmentType, BorderStyle, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';

/**
 * Markdown (as the models write it) → an editable Word document: headings, paragraphs,
 * bullet/numbered lists, **bold** / *italic*, pipe tables and horizontal rules.
 * Deliberately small: drafts are meant to be edited in Word, not typeset.
 */
export function inlineRuns(text: string, base: { bold?: boolean } = {}): TextRun[] {
  const runs: TextRun[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) runs.push(new TextRun({ text: text.slice(last, m.index), bold: base.bold }));
    const t = m[0];
    if (t.startsWith('**')) runs.push(new TextRun({ text: t.slice(2, -2), bold: true }));
    else if (t.startsWith('`')) runs.push(new TextRun({ text: t.slice(1, -1), font: 'Consolas', bold: base.bold }));
    else runs.push(new TextRun({ text: t.slice(1, -1), italics: true, bold: base.bold }));
    last = m.index! + t.length;
  }
  if (last < text.length) runs.push(new TextRun({ text: text.slice(last), bold: base.bold }));
  return runs;
}

const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: 'C9D5DE' };

function table(lines: string[]): Table {
  const rows = lines
    .filter((l) => !/^\s*\|?\s*:?-{2,}/.test(l))
    .map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
  const cols = Math.max(...rows.map((r) => r.length));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(
      (r, i) =>
        new TableRow({
          tableHeader: i === 0,
          children: Array.from({ length: cols }, (_, c) =>
            new TableCell({
              borders: { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder },
              shading: i === 0 ? { fill: 'EEF3F6' } : undefined,
              children: [new Paragraph({ children: inlineRuns(r[c] ?? '', { bold: i === 0 }) })],
            }),
          ),
        }),
    ),
  });
}

export function markdownToBlocks(md: string): Array<Paragraph | Table> {
  const out: Array<Paragraph | Table> = [];
  const lines = md.replace(/\r/g, '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (line.trim().startsWith('|')) {
      const block = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) block.push(lines[i++]);
      i--;
      out.push(table(block), new Paragraph({}));
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4][h[1].length - 1];
      out.push(new Paragraph({ heading: level, children: inlineRuns(h[2].replace(/\*\*/g, '')) }));
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'C9D5DE', space: 1 } } }));
      continue;
    }
    const bullet = /^(\s*)[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      out.push(new Paragraph({ bullet: { level: Math.min(Math.floor(bullet[1].length / 2), 3) }, children: inlineRuns(bullet[2]) }));
      continue;
    }
    const num = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(line);
    if (num) {
      out.push(new Paragraph({ indent: { left: 360 + num[1].length * 180, hanging: 360 }, children: [new TextRun(`${num[2]}.\t`), ...inlineRuns(num[3])] }));
      continue;
    }
    // Plain paragraph: join soft-wrapped lines.
    let text = line.trim();
    while (i + 1 < lines.length && lines[i + 1].trim() && !/^(\s*[-*•]\s|\s*\d+[.)]\s|#|\s*\|)/.test(lines[i + 1])) text += ` ${lines[++i].trim()}`;
    out.push(new Paragraph({ spacing: { after: 120 }, children: inlineRuns(text) }));
  }
  return out;
}

export async function renderDocx(opts: { title: string; subtitle: string; markdown: string }): Promise<Buffer> {
  const doc = new Document({
    creator: 'Xanderia AI Council',
    title: opts.title,
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [
      {
        children: [
          new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(opts.title)] }),
          new Paragraph({ alignment: AlignmentType.LEFT, spacing: { after: 240 }, children: [new TextRun({ text: opts.subtitle, color: '7890A3', size: 18 })] }),
          ...markdownToBlocks(opts.markdown),
          new Paragraph({
            spacing: { before: 360 },
            children: [new TextRun({ text: 'Drafted with the Xanderia AI Council. AI-generated: review and confirm before use.', italics: true, color: '7890A3', size: 16 })],
          }),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}
