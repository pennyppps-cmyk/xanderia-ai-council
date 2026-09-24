import { describe, expect, it } from 'vitest';
import { markdownToBlocks, renderDocx } from '../src/report/docx.js';

describe('markdown → Word', () => {
  it('turns headings, lists, tables and paragraphs into blocks', () => {
    const md = '# SOP\n\nIntro line\nwrapped.\n\n- one\n- **two**\n\n1. first\n2. second\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n---\n';
    const blocks = markdownToBlocks(md);
    // heading, paragraph, 2 bullets, 2 numbered, table + spacer, rule
    expect(blocks).toHaveLength(9);
  });

  it('renders a valid .docx (zip) file', async () => {
    const buf = await renderDocx({ title: 'Staff memo', subtitle: 'Finance', markdown: '## Purpose\nTest **bold** and *italic*.' });
    expect(buf.subarray(0, 2).toString()).toBe('PK');
    expect(buf.length).toBeGreaterThan(3000);
  });
});
