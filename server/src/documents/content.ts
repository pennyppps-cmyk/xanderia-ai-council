import type { Verdict } from '../llm/schemas.js';
import type { DocLang, SectionKind } from './outlines.js';

/** Fixed wording on the page, in the document's language. */
export const LABELS = {
  en: {
    to: 'To',
    from: 'From',
    date: 'Date',
    ref: 'Ref',
    subject: 'Subject',
    draft: 'DRAFT',
    page: 'Page',
    of: 'of',
    level: { low: 'Low', medium: 'Medium', high: 'High' },
    risks: ['No.', 'Risk', 'Likelihood', 'Impact', 'Mitigation'],
    plan: ['No.', 'Action', 'Responsibility', 'Timeline'],
    firstStep: 'First step',
    signoff: ['', 'Prepared by', 'Reviewed by', 'Approved by'],
    signoffRows: ['Signature', 'Name', 'Designation', 'Date'],
    months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  },
  ms: {
    to: 'Kepada',
    from: 'Daripada',
    date: 'Tarikh',
    ref: 'Rujukan',
    subject: 'Perkara',
    draft: 'DRAF',
    page: 'Muka surat',
    of: 'daripada',
    level: { low: 'Rendah', medium: 'Sederhana', high: 'Tinggi' },
    risks: ['Bil.', 'Risiko', 'Kebarangkalian', 'Impak', 'Mitigasi'],
    plan: ['Bil.', 'Tindakan', 'Tanggungjawab', 'Tempoh'],
    firstStep: 'Langkah pertama',
    signoff: ['', 'Disediakan oleh', 'Disemak oleh', 'Diluluskan oleh'],
    signoffRows: ['Tandatangan', 'Nama', 'Jawatan', 'Tarikh'],
    months: ['Januari', 'Februari', 'Mac', 'April', 'Mei', 'Jun', 'Julai', 'Ogos', 'September', 'Oktober', 'November', 'Disember'],
  },
} as const;

/** "30 September 2026", in Kuala Lumpur time. */
export function formatDate(d: Date, lang: DocLang) {
  const kl = new Date(d.getTime() + 8 * 3600_000);
  return `${kl.getUTCDate()} ${LABELS[lang].months[kl.getUTCMonth()]} ${kl.getUTCFullYear()}`;
}

const cell = (s: string) => s.replace(/\|/g, '/').replace(/\s*\n\s*/g, ' ').trim();
const row = (cells: string[]) => `| ${cells.map(cell).join(' | ')} |`;
const table = (head: readonly string[], rows: string[][]) =>
  [row([...head]), row(head.map(() => '---')), ...rows.map(row)].join('\n');

/** Text of a section built from the verdict itself, or null for a section the Secretary writes. */
export function builtSection(kind: SectionKind, v: Verdict, lang: DocLang, preparedBy: { name: string; position: string }): string | null {
  const L = LABELS[lang];
  switch (kind) {
    case 'risks':
      if (!v.risks.length) return '[TBC: key risks and mitigations]';
      return table(
        L.risks,
        v.risks.map((r, i) => [`${i + 1}`, r.risk, L.level[r.likelihood], L.level[r.impact], r.mitigation]),
      );
    case 'action_plan': {
      const plan = table(L.plan, v.action_plan.map((s, i) => [`${i + 1}`, s.step, s.owner_role, s.timeline]));
      return v.first_step ? `**${L.firstStep}:** ${v.first_step}\n\n${plan}` : plan;
    }
    case 'signoff':
      return table(L.signoff, [
        [L.signoffRows[0], '______________________', '______________________', '______________________'],
        [L.signoffRows[1], preparedBy.name, '', ''],
        [L.signoffRows[2], preparedBy.position, '', ''],
        [L.signoffRows[3], '', '', ''],
      ]);
    default:
      return null;
  }
}

/** Open [TBC: ...] placeholders the reviewer still has to fill in. */
export function countTbc(texts: string[]) {
  return texts.reduce((n, t) => n + (t.match(/\[TBC:[^\]]*\]/gi)?.length ?? 0), 0);
}

/**
 * The model's section text, tidied: no code fences, no repeated heading, no "Here is ..." preamble.
 * Headings inside a section are turned into bold lines so they never compete with section headings.
 */
export function cleanSection(raw: string, heading: string) {
  let t = raw.replace(/\r/g, '').trim();
  t = t.replace(/^```[a-z]*\n?|\n?```$/g, '').trim();
  const lines = t.split('\n');
  const norm = (s: string) => s.replace(/[#*_:\d.\s]+/g, ' ').trim().toLowerCase();
  while (lines.length && (!lines[0].trim() || norm(lines[0]) === norm(heading) || /^(here is|here's|berikut)\b.*:\s*$/i.test(lines[0].trim()))) lines.shift();
  return (
    lines
      .map((l) => l.replace(/^#{1,6}\s+(.*)$/, '**$1**').replace(/\s+$/, ''))
      .join('\n')
      // "(TBC: ...)" or "TBC: ..." in round brackets still counts as a placeholder to fill in.
      .replace(/\(\s*TBC\s*:\s*([^()]*)\)/gi, '[TBC: $1]')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}
