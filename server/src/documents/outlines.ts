import { z } from 'zod';

/**
 * Outlines for official documents. `write` sections are drafted by the Secretary from the verdict;
 * `risks`, `action_plan` and `signoff` are built exactly from the verdict's data, so the tables
 * never drift from what the council decided. Admins edit these in Admin → Documents.
 */
export const DOC_TYPES = ['exec_brief', 'board_paper'] as const;
export type DocType = (typeof DOC_TYPES)[number];
export type DocLang = 'en' | 'ms';

export const SectionKind = z.enum(['write', 'risks', 'action_plan', 'signoff']);
export type SectionKind = z.infer<typeof SectionKind>;

export const OutlineSection = z.object({
  key: z.string().regex(/^[a-z0-9_]{1,40}$/),
  heading: z.string().trim().min(1).max(120),
  kind: SectionKind,
  guide: z.string().max(1500).default(''),
});
export type OutlineSection = z.infer<typeof OutlineSection>;

const LangOutline = z.object({
  title: z.string().trim().min(1).max(80),
  sections: z.array(OutlineSection).min(1).max(15),
});

export const DocOutline = z.object({
  name: z.string().trim().min(1).max(80),
  ref_code: z.string().regex(/^[A-Z0-9]{1,10}$/),
  // Board papers number their paragraphs (1.0 / 1.1 / 1.2), as official papers do.
  numbered: z.boolean(),
  en: LangOutline,
  ms: LangOutline,
});
export type DocOutline = z.infer<typeof DocOutline>;

export const DocOutlines = z.object({ exec_brief: DocOutline, board_paper: DocOutline });
export type DocOutlines = z.infer<typeof DocOutlines>;

export const DEFAULT_OUTLINES: DocOutlines = {
  exec_brief: {
    name: 'Executive brief',
    ref_code: 'EXEC',
    numbered: false,
    en: {
      title: 'EXECUTIVE BRIEF',
      sections: [
        { key: 'purpose', heading: 'Purpose', kind: 'write', guide: 'One or two sentences: what this brief is about and what decision it asks the reader to make. At most 60 words.' },
        { key: 'recommendation', heading: 'Recommendation', kind: 'write', guide: 'The recommendation stated plainly in 2-3 sentences, then the first step to take and who takes it. At most 100 words.' },
        { key: 'background', heading: 'Background', kind: 'write', guide: 'The situation and why it needs a decision now, from the request and the attached documents. 80-150 words.' },
        { key: 'reasons', heading: 'Key Reasons', kind: 'write', guide: '3-5 bullets: the main reasons for the recommendation, from the reasoning and the points of agreement. One sentence each.' },
        { key: 'risks', heading: 'Risks and Mitigations', kind: 'risks', guide: '' },
        { key: 'decision', heading: 'Decision Required', kind: 'write', guide: 'What the reader is asked to approve or decide, as 1-3 bullets. Then, if there are open questions, one sentence listing what must be confirmed before acting.' },
      ],
    },
    ms: {
      title: 'TAKLIMAT EKSEKUTIF',
      sections: [
        { key: 'purpose', heading: 'Tujuan', kind: 'write', guide: 'Satu atau dua ayat: perkara taklimat ini dan keputusan yang diminta daripada pembaca. Maksimum 60 patah perkataan.' },
        { key: 'recommendation', heading: 'Syor', kind: 'write', guide: 'Syor dinyatakan dengan jelas dalam 2-3 ayat, diikuti langkah pertama dan siapa yang melaksanakannya. Maksimum 100 patah perkataan.' },
        { key: 'background', heading: 'Latar Belakang', kind: 'write', guide: 'Keadaan semasa dan sebab keputusan diperlukan sekarang, berdasarkan permintaan dan dokumen yang dilampirkan. 80-150 patah perkataan.' },
        { key: 'reasons', heading: 'Justifikasi Utama', kind: 'write', guide: '3-5 poin: sebab utama syor ini, daripada penaakulan dan perkara yang dipersetujui. Satu ayat setiap poin.' },
        { key: 'risks', heading: 'Risiko dan Mitigasi', kind: 'risks', guide: '' },
        { key: 'decision', heading: 'Keputusan Diperlukan', kind: 'write', guide: 'Perkara yang pembaca diminta luluskan atau putuskan, dalam 1-3 poin. Jika ada soalan terbuka, satu ayat menyenaraikan perkara yang perlu disahkan sebelum bertindak.' },
      ],
    },
  },
  board_paper: {
    name: 'Board paper',
    ref_code: 'BP',
    numbered: true,
    en: {
      title: 'BOARD PAPER',
      sections: [
        { key: 'purpose', heading: 'Purpose', kind: 'write', guide: 'One paragraph: what this paper seeks approval for. At most 60 words.' },
        { key: 'background', heading: 'Background', kind: 'write', guide: 'The situation, how it arose and why a decision is needed now, from the request and the attached documents. 2-3 short paragraphs, 120-200 words in total.' },
        { key: 'proposal', heading: 'The Proposal', kind: 'write', guide: 'What is proposed, in detail: scope, who is affected and how it will work, from the recommendation and the action plan. 2-3 short paragraphs, 120-200 words in total.' },
        { key: 'options', heading: 'Options Considered', kind: 'write', guide: 'The alternatives that were weighed, from the disagreements that were resolved. For each option, one short paragraph: the option, its merit, and why it was or was not chosen.' },
        { key: 'financial', heading: 'Financial Implications', kind: 'write', guide: 'Costs, revenue, capital or provisioning effects, using only figures in the source material. Where a figure is needed but not given, write [TBC: ...]. If the source has no financial figures, say in one sentence that the financial impact is to be confirmed by Finance.' },
        { key: 'risks', heading: 'Risk Assessment', kind: 'risks', guide: '' },
        { key: 'plan', heading: 'Implementation Plan', kind: 'action_plan', guide: '' },
        { key: 'recommendation', heading: 'Recommendation', kind: 'write', guide: 'The formal recommendation. Start with "The {addressee} is invited to:" and follow with 2-4 numbered resolutions (approve / note / authorise ...), each one sentence.' },
        { key: 'signoff', heading: 'Approval', kind: 'signoff', guide: '' },
      ],
    },
    ms: {
      title: 'KERTAS CADANGAN',
      sections: [
        { key: 'purpose', heading: 'Tujuan', kind: 'write', guide: 'Satu perenggan: perkara yang dipohon kelulusan melalui kertas ini. Maksimum 60 patah perkataan.' },
        { key: 'background', heading: 'Latar Belakang', kind: 'write', guide: 'Keadaan semasa, bagaimana ia timbul dan sebab keputusan diperlukan sekarang, berdasarkan permintaan dan dokumen yang dilampirkan. 2-3 perenggan pendek, 120-200 patah perkataan kesemuanya.' },
        { key: 'proposal', heading: 'Cadangan', kind: 'write', guide: 'Perkara yang dicadangkan secara terperinci: skop, pihak yang terlibat dan cara pelaksanaan, berdasarkan syor dan pelan tindakan. 2-3 perenggan pendek, 120-200 patah perkataan kesemuanya.' },
        { key: 'options', heading: 'Pilihan yang Dipertimbangkan', kind: 'write', guide: 'Pilihan lain yang ditimbang, daripada percanggahan pendapat yang telah diputuskan. Untuk setiap pilihan, satu perenggan pendek: pilihan itu, kebaikannya, dan sebab ia dipilih atau tidak dipilih.' },
        { key: 'financial', heading: 'Implikasi Kewangan', kind: 'write', guide: 'Kesan kos, hasil, modal atau peruntukan, menggunakan angka dalam bahan sumber sahaja. Jika angka diperlukan tetapi tiada, tulis [TBC: ...]. Jika bahan sumber tiada angka kewangan, nyatakan dalam satu ayat bahawa implikasi kewangan akan disahkan oleh Jabatan Kewangan.' },
        { key: 'risks', heading: 'Penilaian Risiko', kind: 'risks', guide: '' },
        { key: 'plan', heading: 'Pelan Pelaksanaan', kind: 'action_plan', guide: '' },
        { key: 'recommendation', heading: 'Syor', kind: 'write', guide: 'Syor rasmi. Mulakan dengan "{addressee} dengan hormatnya diminta untuk:" diikuti 2-4 resolusi bernombor (meluluskan / mengambil maklum / memberi kuasa ...), satu ayat setiap satu.' },
        { key: 'signoff', heading: 'Kelulusan', kind: 'signoff', guide: '' },
      ],
    },
  },
};

export const DEFAULT_FOOTER: Record<DocLang, string> = {
  en: 'Private & Confidential. This document is the property of Xanderia Berhad (1389777-A). It may not be copied, distributed or disclosed without written permission.',
  ms: 'Sulit & Persendirian. Dokumen ini adalah hak milik Xanderia Berhad (1389777-A). Ia tidak boleh disalin, diedarkan atau didedahkan tanpa kebenaran bertulis.',
};

/** Stored outlines, falling back per document type to the shipped default if one is malformed. */
export function readOutlines(stored: unknown): DocOutlines {
  const out = { ...DEFAULT_OUTLINES };
  const s = (stored ?? {}) as Record<string, unknown>;
  for (const t of DOC_TYPES) {
    const r = DocOutline.safeParse(s[t]);
    if (r.success) out[t] = r.data;
  }
  return out;
}

/** XB/EXEC/2026/014 */
export function formatRef(code: string, year: number, n: number) {
  return `XB/${code}/${year}/${String(n).padStart(3, '0')}`;
}
