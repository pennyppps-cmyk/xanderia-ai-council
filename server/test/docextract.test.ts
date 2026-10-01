import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { composeAttachmentText, detectKind, monthOf, resetExtractorSession, runExtraction, type ExtractorResult } from '../src/rag/docextract.js';

const JANM = `## Page 1\n\nJABATAN AKAUNTAN NEGARA MALAYSIA\nBulan 07/2026\nNama : AHMAD BIN ALI\n0001 Gaji Pokok 3,000.00\nJumlah Pendapatan 3,500.00\nJumlah Potongan 1,200.00\nGaji Bersih 2,300.00`;

describe('which extractor fits an attached file', () => {
  it('recognises payslips, bank statements and Angkasa statements from their text', () => {
    expect(detectKind('slip.pdf', JANM)).toBe('payslip');
    expect(detectKind('stmt.pdf', 'RHB ISLAMIC BANK BERHAD\nStatement Period / Tempoh Penyata : 01 Jul 26 - 31 Jul 26\nBalance')).toBe('base_rhb');
    expect(detectKind('stmt.pdf', 'HONG LEONG BANK\nStatement of account\nBalance 100.00')).toBe('base_hongleong');
    expect(detectKind('stmt.pdf', 'BANK KERJASAMA RAKYAT MALAYSIA\nPenyata Akaun\nBaki')).toBe('base_bankrakyat');
    expect(detectKind('ape.pdf', 'ANGKASA PENYATA\nC950415016119 AHMAD\n4101 100.00 20.00 120.00')).toBe('ape');
    expect(detectKind('ape.pdf', 'ANGKASA PENYATA\nC950415016119 AHMAD\n4120 100.00 20.00 120.00\n4141 1.00 1.00 2.00')).toBe('ape_pc');
  });

  it('leaves ordinary documents alone, and sends scans and photos to OCR', () => {
    expect(detectKind('plan.pdf', 'Quarterly collections plan for the Klang branch, with targets')).toBeNull();
    expect(detectKind('memo.docx', JANM)).toBeNull(); // only PDFs and images go to the extractor
    expect(detectKind('scan.pdf', '')).toBe('payslip');
    expect(detectKind('IC_ahmad.jpg', '')).toBe('ic');
    expect(detectKind('mykad-front.png', '')).toBe('ic');
  });

  it('reads the month from the date formats banks use', () => {
    expect(monthOf('03/07/2026')).toBe('2026-07');
    expect(monthOf('2026-07-03T00:00:00')).toBe('2026-07');
    expect(monthOf('03 Jul 26')).toBe('2026-07');
    expect(monthOf('')).toBeNull();
  });
});

describe('what the council reads', () => {
  it('puts checked payslip figures and warnings before the page text', () => {
    const r: ExtractorResult = {
      status: 'review',
      confidence: 0.91,
      warnings: ['Unrecognized wage type codes require review'],
      fields: {
        employee_name: 'Ahmad Bin Ali', pay_period: '07/2026', gross_pay: 3500, total_deductions: 1200, net_pay: 2300, net_salary_percent: 65.71,
        earnings: [{ code: '0001', description: 'Gaji Pokok', amount: 3000 }],
        deductions: [{ code: '4101', description: 'Angkasa', amount: 1200 }],
        unclassified_items: [{ code: '9999', description: 'Unknown', amount: 5 }],
      },
    };
    const text = composeAttachmentText('payslip', r, JANM);
    expect(text.indexOf('Checked figures')).toBeLessThan(text.indexOf('## Document text'));
    expect(text).toContain('| Net pay (Gaji Bersih) | RM 2,300.00 |');
    expect(text).toContain('| Net ÷ gross (worked out) | 65.71% |');
    expect(text).toContain('flagged for human review');
    expect(text).toContain('- Unrecognized wage type codes require review');
    expect(text).toContain('- 9999 Unknown: RM 5.00');
  });

  it('summarises a bank statement: totals, months, largest items, repeating credits and bounced items', () => {
    const r: ExtractorResult = {
      status: 'completed', confidence: 1, warnings: [],
      fields: {
        headers: ['PDF_FILE', 'No. Akaun', 'Statement Period', 'Tarikh', 'Kod Transaksi', 'Keterangan', 'Debit', 'Kredit', 'Baki'],
        records: [
          { 'No. Akaun': '1234', 'Statement Period': 'Jun-Jul 2026', Tarikh: '25/06/2026', Keterangan: 'GAJI JABATAN 06', Debit: '', Kredit: 3000, Baki: 3100 },
          { Tarikh: '28/06/2026', Keterangan: 'CHEQUE RETURNED', Debit: 500, Kredit: '', Baki: 2600 },
          { Tarikh: '25/07/2026', Keterangan: 'GAJI JABATAN 07', Debit: '', Kredit: 3000, Baki: 5600 },
        ],
      },
    };
    const text = composeAttachmentText('base_bankrakyat', r, '');
    expect(text).toContain('| Transactions | 3 |');
    expect(text).toContain('| Total money in (credits) | RM 6,000.00 |');
    expect(text).toContain('| Closing balance (last transaction) | RM 5,600.00 |');
    expect(text).toContain('| 2026-06 | 2 | RM 3,000.00 | RM 500.00 | RM 2,600.00 |');
    expect(text).toContain('GAJI JABATAN (2 months)');
    expect(text).toContain('CHEQUE RETURNED');
  });

  it('keeps only the OCR text when a scan turns out not to be a payslip', () => {
    const r: ExtractorResult = { status: 'review', confidence: 0.5, warnings: ['Net pay was not found'], fields: { page_content: [{ page: 1, text: 'Surat tawaran pembiayaan' }] } };
    expect(composeAttachmentText('payslip', r, '')).toBe('## Document text (read by OCR)\n\n### Page 1\n\nSurat tawaran pembiayaan');
  });
});

describe('talking to the extractor', () => {
  const saved = { url: config.EXTRACTOR_URL, user: config.EXTRACTOR_USER, pass: config.EXTRACTOR_PASSWORD };
  beforeEach(() => {
    Object.assign(config, { EXTRACTOR_URL: 'http://extractor:8001/', EXTRACTOR_USER: 'council', EXTRACTOR_PASSWORD: 'pw' });
    resetExtractorSession();
  });
  afterEach(() => Object.assign(config, { EXTRACTOR_URL: saved.url, EXTRACTOR_USER: saved.user, EXTRACTOR_PASSWORD: saved.pass }));

  function fakeExtractor(opts: { expireFirstJob?: boolean } = {}) {
    const calls: Array<{ url: string; method: string; csrf?: string; cookie?: string }> = [];
    let logins = 0;
    let polls = 0;
    const impl = (async (url: string, init: RequestInit = {}) => {
      const h = (init.headers ?? {}) as Record<string, string>;
      calls.push({ url, method: init.method ?? 'GET', csrf: h['x-csrf-token'], cookie: h.cookie });
      if (url.endsWith('/api/auth/login')) {
        logins += 1;
        const headers = new Headers();
        headers.append('set-cookie', `extractor_session=s${logins}; HttpOnly; Path=/`);
        headers.append('set-cookie', `extractor_csrf=c${logins}; Path=/`);
        return new Response('{}', { status: 200, headers });
      }
      if (url.endsWith('/api/jobs') && init.method === 'POST') {
        if (opts.expireFirstJob && logins === 1) return new Response('{"detail":"Authentication required"}', { status: 401 });
        expect((init.body as FormData).get('document_type')).toBe('payslip');
        return new Response(JSON.stringify({ id: 'job1', status: 'queued' }), { status: 202 });
      }
      if (url.endsWith('/api/jobs/job1')) {
        polls += 1;
        if (polls < 2) return Response.json({ status: 'processing', results: [] });
        return Response.json({ status: 'completed', results: [{ status: 'completed', confidence: 0.99, fields: { net_pay: 2300 }, warnings: [] }] });
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;
    return { impl, calls, logins: () => logins };
  }

  it('logs in, sends the file with the CSRF token, and waits for the result', async () => {
    const fake = fakeExtractor();
    const r = await runExtraction('payslip', 'slip.pdf', Buffer.from('%PDF'), { fetchImpl: fake.impl, pollMs: 1 });
    expect(r.fields.net_pay).toBe(2300);
    const post = fake.calls.find((c) => c.method === 'POST' && c.url === 'http://extractor:8001/api/jobs')!;
    expect(post.csrf).toBe('c1');
    expect(post.cookie).toBe('extractor_session=s1; extractor_csrf=c1');
    // The session is reused for the next file.
    await runExtraction('payslip', 'slip2.pdf', Buffer.from('%PDF'), { fetchImpl: fake.impl, pollMs: 1 });
    expect(fake.logins()).toBe(1);
  });

  it('logs in again when the session has expired', async () => {
    const fake = fakeExtractor({ expireFirstJob: true });
    const r = await runExtraction('payslip', 'slip.pdf', Buffer.from('%PDF'), { fetchImpl: fake.impl, pollMs: 1 });
    expect(r.status).toBe('completed');
    expect(fake.logins()).toBe(2);
  });
});
