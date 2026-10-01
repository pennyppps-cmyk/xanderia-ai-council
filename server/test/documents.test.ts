import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import PizZip from 'pizzip';
import { describe, expect, it } from 'vitest';
import { builtSection, cleanSection, countTbc, formatDate } from '../src/documents/content.js';
import { DEFAULT_OUTLINES, DocOutlines, formatRef, readOutlines } from '../src/documents/outlines.js';
import { renderDocument, sectionBody, type RenderInput } from '../src/documents/render.js';
import { canApprove, canDownload, canView } from '../src/documents/service.js';
import type { Verdict } from '../src/llm/schemas.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const letterhead = readFileSync(path.resolve(here, '../assets/letterhead.docx'));

function wellFormed(xml: string) {
  const errors: string[] = [];
  const fail = (m: string) => errors.push(m);
  new DOMParser({ errorHandler: { warning: () => {}, error: fail, fatalError: fail } }).parseFromString(xml, 'text/xml');
  return errors;
}

const input = (over: Partial<RenderInput> = {}): RenderInput => ({
  title: 'BOARD PAPER',
  meta: [
    ['To', 'Board of Directors'],
    ['Ref', 'DRAFT'],
    ['Subject', '**Collections <pilot> & "SMS" reminders**'],
  ],
  numbered: true,
  sections: [
    { heading: 'Purpose', content: 'To seek approval for the pilot.\n\nIt runs in [TBC: which branches].' },
    { heading: 'Risks', content: '| No. | Risk |\n|---|---|\n| 1 | Customer complaints |' },
  ],
  footer: 'This document is the property of Xanderia Berhad (1389777-A).',
  pageLabel: { page: 'Page', of: 'of' },
  ...over,
});

const verdict: Verdict = {
  verdict: 'Run the pilot.',
  why: 'It is cheap.',
  agreements: [],
  conflicts: [],
  blind_spots: [],
  first_step: 'Head of Collections picks two branches this week.',
  action_plan: [{ step: 'Pick branches | pilot', owner_role: 'Head of Collections', timeline: 'Week 1', start_week: 1, duration_weeks: 1 }],
  risks: [{ risk: 'Complaints', likelihood: 'medium', impact: 'high', mitigation: 'Script review' }],
  open_questions: [],
  confidence: { level: 'medium', what_would_change: 'n/a' },
};

describe('official document on the letterhead', () => {
  const out = new PizZip(renderDocument(letterhead, input()));
  const doc = out.file('word/document.xml')!.asText();
  const footer = out.file('word/footerXc.xml')!.asText();

  it('produces well-formed XML parts', () => {
    expect(wellFormed(doc)).toEqual([]);
    expect(wellFormed(footer)).toEqual([]);
    expect(wellFormed(out.file('word/_rels/document.xml.rels')!.asText())).toEqual([]);
    expect(wellFormed(out.file('[Content_Types].xml')!.asText())).toEqual([]);
  });

  it('sets the page to A4 and keeps the letterhead margins', () => {
    expect(doc).toContain('<w:pgSz w:w="11906" w:h="16838"/>');
    expect(doc).toContain('w:top="1890"');
    expect(doc).not.toContain('w:w="12240"');
  });

  it('keeps the letterhead header and logo untouched', () => {
    const src = new PizZip(letterhead);
    expect(out.file('word/header1.xml')!.asText()).toBe(src.file('word/header1.xml')!.asText());
    expect(out.file('word/media/image1.png')).toBeTruthy();
    expect(doc).toContain('<w:headerReference w:type="default" r:id="rId8"/><w:footerReference w:type="default" r:id="rIdXcFooter"/>');
  });

  it('adds the ownership footer with page X of Y', () => {
    expect(out.file('word/_rels/document.xml.rels')!.asText()).toContain('Target="footerXc.xml"');
    expect(out.file('[Content_Types].xml')!.asText()).toContain('/word/footerXc.xml');
    expect(footer).toContain('property of Xanderia Berhad');
    expect(footer).toContain(' PAGE ');
    expect(footer).toContain(' NUMPAGES ');
  });

  it('escapes text, highlights [TBC] and numbers the paragraphs of a paper', () => {
    expect(doc).toContain('Collections &lt;pilot&gt; &amp; &quot;SMS&quot; reminders');
    expect(doc).toMatch(/<w:highlight w:val="yellow"\/><\/w:rPr><w:t xml:space="preserve">\[TBC: which branches\]/);
    expect(doc).toContain('>1.0<');
    expect(doc).toContain('>1.1<');
    expect(doc).toContain('>1.2<');
    expect(doc).toContain('>2.0<');
    expect(doc).toContain('<w:tblHeader/>');
  });

  it('can be rendered again from its own output (a re-uploaded document still works)', () => {
    const again = new PizZip(renderDocument(out.generate({ type: 'nodebuffer' }) as Buffer, input({ numbered: false })));
    const rels = again.file('word/_rels/document.xml.rels')!.asText();
    expect(rels.match(/rIdXcFooter/g)).toHaveLength(1);
    expect(again.file('[Content_Types].xml')!.asText().match(/footerXc/g)).toHaveLength(1);
    expect(again.file('word/document.xml')!.asText().match(/footerReference/g)).toHaveLength(1);
  });

  it('rejects a file that is not a Word document', () => {
    expect(() => renderDocument(Buffer.from('not a zip'), input())).toThrow(/not a Word document/);
  });
});

describe('section text', () => {
  it('numbers plain paragraphs but not bullets in a numbered paper', () => {
    const xml = sectionBody('First.\n\n- a point\n- another\n\nSecond.', { numbered: true, sectionNo: 3, textWidth: 9000 });
    expect(xml).toContain('>3.1<');
    expect(xml).toContain('>3.2<');
    expect(xml).not.toContain('>3.3<');
    expect(xml.match(/>•</g)).toHaveLength(2);
  });

  it('builds the risk table, action plan and sign-off from the verdict, in the document language', () => {
    const author = { name: 'Aina', position: 'Head of Collections' };
    const risksMs = builtSection('risks', verdict, 'ms', author)!;
    expect(risksMs).toContain('| Bil. | Risiko | Kebarangkalian | Impak | Mitigasi |');
    expect(risksMs).toContain('| 1 | Complaints | Sederhana | Tinggi | Script review |');
    const plan = builtSection('action_plan', verdict, 'en', author)!;
    expect(plan).toContain('**First step:** Head of Collections picks two branches this week.');
    expect(plan).toContain('Pick branches / pilot'); // a pipe in the text never breaks the table
    expect(builtSection('signoff', verdict, 'en', author)).toContain('| Name | Aina |');
    expect(builtSection('write', verdict, 'en', author)).toBeNull();
  });

  it('tidies model output: no repeated heading, preamble or code fence', () => {
    expect(cleanSection('## 2.0 Background\n\nThe text.', 'Background')).toBe('The text.');
    expect(cleanSection('Here is the section:\n**Purpose:**\nThe text.\n### Detail\nMore.', 'Purpose')).toBe('The text.\n**Detail**\nMore.');
    expect(cleanSection('```markdown\nBody\n```', 'Anything')).toBe('Body');
    // Qwen sometimes writes the placeholder in round brackets.
    expect(cleanSection('Cost is (TBC: SMS budget) a month.', 'Cost')).toBe('Cost is [TBC: SMS budget] a month.');
  });

  it('counts open placeholders', () => {
    expect(countTbc(['a [TBC: budget] b [tbc: date]', 'none'])).toBe(2);
  });

  it('formats dates in Kuala Lumpur time and the right language', () => {
    const d = new Date('2026-09-30T17:00:00Z'); // 1 October, 01:00 in KL
    expect(formatDate(d, 'en')).toBe('1 October 2026');
    expect(formatDate(new Date('2026-08-10T02:00:00Z'), 'ms')).toBe('10 Ogos 2026');
  });
});

describe('outlines and reference numbers', () => {
  it('ships valid outlines', () => {
    expect(DocOutlines.safeParse(DEFAULT_OUTLINES).success).toBe(true);
  });

  it('falls back to the shipped outline when a stored one is broken', () => {
    const custom = { ...DEFAULT_OUTLINES.exec_brief, name: 'Brief' };
    const got = readOutlines({ exec_brief: custom, board_paper: { name: '' } });
    expect(got.exec_brief.name).toBe('Brief');
    expect(got.board_paper).toEqual(DEFAULT_OUTLINES.board_paper);
  });

  it('formats reference numbers', () => {
    expect(formatRef('EXEC', 2026, 14)).toBe('XB/EXEC/2026/014');
    expect(formatRef('BP', 2027, 1200)).toBe('XB/BP/2027/1200');
  });
});

describe('who may do what', () => {
  const doc = { created_by: 'author', department_id: 'finance', status: 'draft' as const };
  const u = (id: string, role: 'employee' | 'dept_lead' | 'admin', department_id = 'finance') => ({ id, role, department_id });

  it('shows a document to its author, the department lead and admins only', () => {
    expect(canView(doc, u('author', 'employee'))).toBe(true);
    expect(canView(doc, u('lead', 'dept_lead'))).toBe(true);
    expect(canView(doc, u('lead2', 'dept_lead', 'hr'))).toBe(false);
    expect(canView(doc, u('colleague', 'employee'))).toBe(false);
    expect(canView(doc, u('admin', 'admin', 'hr'))).toBe(true);
  });

  it('lets the author approve only where review before acting is off', () => {
    expect(canApprove(doc, u('author', 'employee'), false)).toBe(true);
    expect(canApprove(doc, u('author', 'employee'), true)).toBe(false);
    expect(canApprove(doc, u('lead', 'dept_lead'), true)).toBe(true);
    expect(canApprove(doc, u('lead2', 'dept_lead', 'hr'), true)).toBe(false);
  });

  it('holds back drafts from review-before-acting departments', () => {
    expect(canDownload({ status: 'draft' }, false)).toBe(true);
    expect(canDownload({ status: 'draft' }, true)).toBe(false);
    expect(canDownload({ status: 'approved' }, true)).toBe(true);
    expect(canDownload({ status: 'writing' }, false)).toBe(false);
  });
});
