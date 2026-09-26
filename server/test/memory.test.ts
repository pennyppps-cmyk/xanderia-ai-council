import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { memoryBlock } from '../src/memory/memory.js';
import { improvementReportText } from '../src/memory/report.js';
import { extractDocumentText } from '../src/rag/extract.js';

describe('company memory prompt', () => {
  it('puts house rules first, then approved answers, then lessons with outcomes', () => {
    const block = memoryBlock({
      rules: [{ text: 'Our NPL definition is 90 days past due; restructured loans are included.', department: 'Finance' }],
      approved: [{ question: 'How do we compute NPL?', answer: 'NPL balance / total gross balance, monthly.', distance: 0.2 }],
      lessons: [
        { title: 'Pilot WhatsApp reminders', summary: 'Two branches for 8 weeks.', department: 'Credit & Collections', decided: '2026-03-02', status: 'done', outcome: { rating: 'worked', note: 'cure rate up 12%' }, distance: 0.3 },
        { title: 'Outsource field collection', summary: 'Agency in Kelantan.', department: null, decided: '2026-05-10', status: 'in_progress', outcome: null, distance: 0.4 },
      ],
    });
    expect(block.indexOf('house rules')).toBeLessThan(block.indexOf('Approved company answers'));
    expect(block.indexOf('Approved company answers')).toBeLessThan(block.indexOf('Lessons from past'));
    expect(block).toContain('90 days past due');
    expect(block).toContain('Outcome: worked (cure rate up 12%)');
    expect(block).toContain('Outcome not recorded yet (status: in_progress)');
    expect(memoryBlock({ rules: [], approved: [], lessons: [] })).toBe('');
  });

  it('writes a readable improvement report with suggestions', () => {
    const lines = improvementReportText({
      days: 30,
      feedback: [{ department: 'Finance', helpful: 2, unhelpful: 5 }],
      comments: [{ date: '2026-09-20', department: 'Finance', mode: 'quick', comment: 'Wrong NPL definition' }],
      noSources: [{ department: 'Finance', answers: 10, without_sources: 8 }],
      pending: [],
      noOutcome: 0,
      stale: 0,
      memory: { approved: 0, rules: 0, decisions: 3, outcomes: 1 },
      latency: [{ mode: 'council', n: 12, p90_seconds: 24 }],
      suggestions: ['Finance: upload its SOPs.'],
    });
    const text = lines.join('\n');
    expect(text).toContain('Finance 2 helpful / 5 not helpful');
    expect(text).toContain('Finance 8/10');
    expect(text).toContain('council 24s');
    expect(text).toContain('• Finance: upload its SOPs.');
    expect(text).toContain('Wrong NPL definition');
  });
});

describe('Obsidian vault import', () => {
  it('turns a zip of Markdown notes into one section per note, simplifying Obsidian syntax', async () => {
    const zip = new JSZip();
    zip.file('Vault/Collections/NPL rules.md', '---\ntags: [policy]\n---\n# NPL\nA loan is NPL at [[Definitions|90 days]] past due.\n![[chart.png]]');
    zip.file('Vault/Definitions.md', 'See [[NPL rules]].');
    zip.file('Vault/.obsidian/workspace.json', '{}');
    zip.file('Vault/image.png', 'binary');
    const text = await extractDocumentText('vault.zip', await zip.generateAsync({ type: 'nodebuffer' }));
    expect(text).toContain('## Collections / NPL rules');
    expect(text).toContain('### NPL'); // the note's own heading sits under the note
    expect(text).toContain('A loan is NPL at 90 days past due.');
    expect(text).toContain('See NPL rules.');
    expect(text).not.toContain('tags:');
    expect(text).not.toContain('chart.png');
    expect(text).not.toContain('workspace');
  });

  it('rejects a zip with no notes', async () => {
    const zip = new JSZip();
    zip.file('a.png', 'x');
    await expect(extractDocumentText('x.zip', await zip.generateAsync({ type: 'nodebuffer' }))).rejects.toThrow(/no Markdown/);
  });
});
