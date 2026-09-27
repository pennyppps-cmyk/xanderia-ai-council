import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import PDFDocument from 'pdfkit';
import { msDate, type LetterData } from './masterlist.js';

/**
 * The "Makluman Tunggakan Bayaran Ansuran Bulanan" letter, the covering email and the
 * Outlook-ready draft (.eml) — the same wording as the notis-blast template Collections uses.
 * Company, bank and contact details are in one place below.
 */
export const COMPANY = {
  name: 'XANDERIA SERVICES SDN BHD',
  signName: 'XANDERIA SERVICES SDN. BHD.',
  reg: '201801042883 (1304915-W)',
  footer1: 'XANDERIA SERVICES SDN BHD (201801042883) | Unit 17-01, Menara Q Sentral, No 2A, Jalan Stesen Sentral 2, Kuala Lumpur Sentral, 50470 Kuala Lumpur',
  footer2: 'Tel: 03-2276 7280 | Hotline: 1 300 88 9945 | Website: www.xanderia.com | Email: info@xanderia.com',
  bankAccountName: 'Xanderia Services Sdn Bhd',
  bank: 'Hong Leong Bank',
  bankAccountNo: '04801532584',
  collectionsEmail: 'collections@xanderia.com',
  serviceEmail: 'customer.service@xanderia.com',
  servicePhone: '03-2276 7280',
  hotline: '1 300 88 9945',
};
export const EMAIL_SUBJECT = 'Makluman Tunggakan Bayaran Ansuran Bulanan Pembiayaan Peribadi';

const here = path.dirname(fileURLToPath(import.meta.url));
const LOGO = [path.resolve(here, '../../assets/xanderia_logo.png'), path.resolve(here, '../assets/xanderia_logo.png')].find((p) => existsSync(p));
const logo = LOGO ? readFileSync(LOGO) : null;

const money = (n: number | null) => (n == null ? '' : n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const int = (n: number | null) => (n == null ? '' : String(Math.round(n)));

export function letterFileName(d: LetterData) {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return `Notis_${safe(d.customer_name) || 'Pelanggan'}_${safe(d.account_number)}.pdf`;
}

// ── PDF letter ───────────────────────────────────────────────────────────────
const MM = 72 / 25.4;
const PAGE = { w: 595.28, h: 841.89, top: 20 * MM, bottom: 28 * MM, side: 18 * MM };
const W = PAGE.w - PAGE.side * 2;
const INK = '#1a1a1a';

export function renderLetter(d: LetterData, noticeDate: string): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: PAGE.top, bottom: PAGE.bottom, left: PAGE.side, right: PAGE.side },
    info: { Title: 'Makluman Tunggakan Bayaran Ansuran Bulanan', Author: COMPANY.name },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  // Footer on every page; the cursor is put back so the page's content starts at the top.
  const footer = () => {
    const { x, y } = doc;
    const state = doc as unknown as { _font: unknown; _fontSize: number; _fillColor: unknown };
    const saved = { font: state._font, size: state._fontSize, fill: state._fillColor };
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(6.6).fillColor('#888888');
    doc.text(COMPANY.footer1, PAGE.side, PAGE.h - PAGE.bottom + 18, { width: W, align: 'center' });
    doc.text(COMPANY.footer2, PAGE.side, doc.y, { width: W, align: 'center' });
    doc.page.margins.bottom = bottom;
    doc.x = x;
    doc.y = y;
    state._font = saved.font;
    state._fontSize = saved.size;
    state._fillColor = saved.fill;
  };
  doc.on('pageAdded', footer);
  footer();

  const body = (size = 10.5) => doc.font('Helvetica').fontSize(size).fillColor(INK);
  const bold = (size = 10.5) => doc.font('Helvetica-Bold').fontSize(size).fillColor(INK);
  // A justified paragraph with bold parts, laid out word by word (pdfkit's own "continued" text
  // wraps mixed fonts unreliably). A paragraph is never split across pages.
  const para = (input: Array<[string, boolean?]>) => {
    const SIZE = 10.5;
    const fontOf = (b?: boolean) => (b ? 'Helvetica-Bold' : 'Helvetica');
    // Words made of runs: "2026" (bold) + "." (regular) with no space between is one word.
    const words: Array<Array<{ t: string; b?: boolean }>> = [];
    let glued = false;
    for (const [t, b] of input) {
      t.split(/(\s+)/).forEach((piece) => {
        if (!piece) return;
        if (/^\s+$/.test(piece)) return void (glued = false);
        if (glued && words.length) words[words.length - 1].push({ t: piece, b });
        else words.push([{ t: piece, b }]);
        glued = true;
      });
    }
    const width = (w: Array<{ t: string; b?: boolean }>) => w.reduce((n, r) => n + doc.font(fontOf(r.b)).fontSize(SIZE).widthOfString(r.t), 0);
    const space = doc.font('Helvetica').fontSize(SIZE).widthOfString(' ');
    const lines: Array<Array<Array<{ t: string; b?: boolean }>>> = [[]];
    let used = 0;
    for (const w of words) {
      const ww = width(w);
      const line = lines[lines.length - 1];
      if (line.length && used + space + ww > W) {
        lines.push([w]);
        used = ww;
      } else {
        used += (line.length ? space : 0) + ww;
        line.push(w);
      }
    }
    const lh = doc.font('Helvetica').fontSize(SIZE).currentLineHeight(true) + 2.2;
    doc.moveDown(0.55);
    if (doc.y + lines.length * lh > PAGE.h - PAGE.bottom) doc.addPage();
    let y = doc.y;
    lines.forEach((line, i) => {
      const natural = line.reduce((n, w) => n + width(w), 0);
      const gap = i < lines.length - 1 && line.length > 1 ? (W - natural) / (line.length - 1) : space;
      let x = PAGE.side;
      for (const w of line) {
        for (const r of w) {
          doc.font(fontOf(r.b)).fontSize(SIZE).fillColor(INK).text(r.t, x, y, { lineBreak: false });
          x += doc.widthOfString(r.t);
        }
        x += gap;
      }
      y += lh;
    });
    doc.x = PAGE.side;
    doc.y = y - 2.2;
    body();
  };

  // Header
  let y = PAGE.top;
  bold(16).text(COMPANY.name, PAGE.side, y);
  bold(10).text(COMPANY.reg, PAGE.side, doc.y + 1);
  if (logo) doc.image(logo, PAGE.side + W - 72, y - 4, { width: 72 });
  y = Math.max(doc.y, y + 62) + 6;
  doc.moveTo(PAGE.side, y).lineTo(PAGE.side + W, y).lineWidth(1.1).strokeColor(INK).stroke();
  y += 16;

  // Recipient + reference
  const rightLine = (label: string, value: string, ly: number) => {
    const vw = doc.font('Helvetica').fontSize(10).widthOfString(value);
    const lw = doc.font('Helvetica-Bold').fontSize(10).widthOfString(label);
    const x = PAGE.side + W - vw - lw;
    doc.fillColor(INK).text(label, x, ly, { lineBreak: false });
    doc.font('Helvetica').text(value, x + lw, ly, { lineBreak: false });
  };
  rightLine('Ruj: ', d.account_number, y);
  rightLine('Tarikh: ', noticeDate, y + 14);
  bold().text('Tuan / Puan,', PAGE.side, y, { width: W * 0.58 });
  body().text(d.customer_name, { width: W * 0.58 });
  if (d.address) body().text(d.address.replace(/\r/g, ''), { width: W * 0.58, lineGap: 1.5 });
  doc.y += 14;

  // Subject
  bold().text('MAKLUMAN TUNGGAKAN BAYARAN ANSURAN BULANAN PEMBIAYAAN PERIBADI', PAGE.side, doc.y, { width: W });
  bold().text(`NO. KAD PENGENALAN: ${d.ic}`, PAGE.side, doc.y + 2, { width: W });

  para([
    [`Merujuk kepada perkara di atas, kami ingin memaklumkan bahawa semakan rekod setakat ${msDate(d.as_of_date)} kami mendapati potongan gaji bulanan melalui Skim Potongan Gaji Angkasa bagi akaun Pembiayaan tuan/puan tidak berjaya dikreditkan ke akaun pembiayaan kami bagi bulan berikut: `],
    [d.month_in_arrears, true],
    ['.'],
  ]);
  para([
    ['Keadaan ini mungkin berlaku disebabkan oleh beberapa faktor seperti cuti tanpa gaji (Non Pay Leave), gaji tidak mencukupi, pertukaran majikan, isu pentadbiran atau faktor lain yang menyebabkan potongan gaji melalui Skim Potongan Gaji ANGKASA tidak berjaya dibuat.'],
  ]);
  para([['Sehubungan itu, butiran pembiayaan terkini adalah seperti berikut:']]);

  // Details table
  const rows: Array<[string, string, boolean?]> = [
    ['No. Akaun Pembiayaan', d.account_number],
    ['Jumlah Pembiayaan', `RM ${money(d.disbursement_amount)}`],
    ['Tempoh Pembiayaan', `${int(d.tenure)} Bulan`],
    ['Ansuran Bulanan', `RM ${money(d.monthly_installment)}`],
    ['Tempoh Tiada Potongan', d.month_in_arrears],
    ['Bilangan Bulan', `${int(d.overdue_month)} Bulan`],
    ['Jumlah Tertunggak', `RM ${money(d.outstanding_amount)}`, true],
  ];
  y = doc.y + 10;
  const lw = W * 0.45;
  for (const [label, value, hi] of rows) {
    body().font(hi ? 'Helvetica-Bold' : 'Helvetica');
    const h = Math.max(doc.heightOfString(value, { width: W - lw - 20 }), doc.heightOfString(label, { width: lw - 20 })) + 12;
    if (y + h > PAGE.h - PAGE.bottom) {
      doc.addPage();
      y = PAGE.top;
    }
    doc.rect(PAGE.side, y, lw, h).fill(hi ? '#fdecea' : '#f2f2f2');
    doc.rect(PAGE.side + lw, y, W - lw, h).fill(hi ? '#fdecea' : '#ffffff');
    doc.rect(PAGE.side, y, W, h).lineWidth(0.6).strokeColor('#d0d0d0').stroke();
    doc.moveTo(PAGE.side + lw, y).lineTo(PAGE.side + lw, y + h).stroke();
    const color = hi ? '#c0392b' : INK;
    doc.font(hi ? 'Helvetica-Bold' : 'Helvetica-Bold').fontSize(10.5).fillColor(color).text(label, PAGE.side + 10, y + 6, { width: lw - 20 });
    doc.font(hi ? 'Helvetica-Bold' : 'Helvetica').fontSize(10.5).fillColor(color).text(value, PAGE.side + lw + 10, y + 6, { width: W - lw - 20 });
    y += h;
  }
  doc.x = PAGE.side;
  doc.y = y + 4;

  para([['Mohon Tuan/Puan membuat pembayaran bagi jumlah tertunggak di atas dengan kadar segera bagi memastikan rekod pembiayaan dikemas kini dan mengelakkan tunggakan terus meningkat.']]);

  // Payment details
  doc.moveDown(0.7);
  bold().text('Maklumat Pembayaran', PAGE.side, doc.y);
  doc.moveDown(0.25);
  for (const [k, v] of [['Nama Akaun', COMPANY.bankAccountName], ['Bank', COMPANY.bank], ['No. Akaun', COMPANY.bankAccountNo]]) {
    const ly = doc.y;
    bold().text(k, PAGE.side, ly, { width: 105 });
    body().text(`: ${v}`, PAGE.side + 105, ly, { width: W - 105 });
    doc.y += 1.5;
  }
  doc.x = PAGE.side;

  para([['Selepas pembayaran dibuat, sila e-melkan bukti pembayaran kepada '], [COMPANY.collectionsEmail, true], [' dengan kadar segera.']]);
  para([['Sekiranya Tuan/Puan mendapati potongan gaji melalui ANGKASA telah dibuat bagi tempoh tersebut, sila kemukakan bukti potongan atau dokumen berkaitan (seperti slip gaji) untuk tujuan semakan lanjut.']]);
  para([
    ['Sekiranya tuan/puan memerlukan sebarang penjelasan, sila hubungi Bahagian Khidmat Pelanggan Kami di no Telefon '],
    [COMPANY.servicePhone, true],
    [' atau e-mel '],
    [COMPANY.serviceEmail, true],
    ['.'],
  ]);
  para([['Kerjasama dan perhatian Tuan/Puan amat kami hargai. Sekian, terima kasih.']]);

  // Signature
  if (doc.y > PAGE.h - PAGE.bottom - 110) doc.addPage();
  doc.moveDown(1.4);
  body().text('Yang benar, Bagi pihak', PAGE.side, doc.y);
  bold().text(COMPANY.signName, PAGE.side, doc.y + 4);
  doc.font('Helvetica-Oblique').fontSize(10.5).fillColor('#555555').text('Collection Dept');
  doc.moveDown(1.2);
  bold().text('COLLECTION DEPARTMENT');
  body().text(`Email: ${COMPANY.collectionsEmail}`);

  doc.end();
  return done;
}

// ── Covering email ───────────────────────────────────────────────────────────
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function emailBody(d: LetterData) {
  const months = `${d.month_in_arrears}${d.overdue_month ? ` (${int(d.overdue_month)} bulan)` : ''}`;
  const lines = [
    `Assalamualaikum w.b.t. / Salam Sejahtera ${d.customer_name},`,
    `Bersama ini dilampirkan Notis Tunggakan Bayaran Ansuran Bulanan bagi akaun pembiayaan peribadi ${d.account_number} berikutan potongan gaji melalui ANGKASA yang tidak diterima bagi bulan ${months}. Maklumat ini adalah berdasarkan rekod kami pada tarikh notis dikeluarkan.`,
    `Jumlah tertunggak semasa: RM ${money(d.outstanding_amount)}.`,
    `Sila rujuk lampiran untuk butiran lengkap dan maklumat pembayaran. Selepas pembayaran dibuat, sila e-melkan bukti pembayaran kepada ${COMPANY.collectionsEmail}.`,
    'Jika Tuan/Puan mendapati potongan gaji telah dibuat pada bulan yang dinyatakan, sila hantar slip gaji bagi proses semakan dari pihak kami.',
    'Sekian, terima kasih.',
  ];
  const sign = ['Collections Department', 'Xanderia Services Sdn Bhd', `Tel: ${COMPANY.servicePhone} | Hotline: ${COMPANY.hotline}`];
  const text = [...lines, '', ...sign].join('\n\n');
  const b = (s: string) => `<strong>${esc(s)}</strong>`;
  const html = `<!DOCTYPE html><html lang="ms"><body style="font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; color: #1a1a1a; line-height: 1.5;">
<p>Assalamualaikum w.b.t. / Salam Sejahtera ${esc(d.customer_name)},</p>
<p>Bersama ini dilampirkan ${b('Notis Tunggakan Bayaran Ansuran Bulanan')} bagi akaun pembiayaan peribadi ${b(d.account_number)} berikutan potongan gaji melalui ANGKASA yang tidak diterima bagi bulan ${b(months)}. Maklumat ini adalah berdasarkan rekod kami pada tarikh notis dikeluarkan.</p>
<p>Jumlah tertunggak semasa: ${b(`RM ${money(d.outstanding_amount)}`)}.</p>
<p>Sila rujuk lampiran untuk butiran lengkap dan maklumat pembayaran. Selepas pembayaran dibuat, sila e-melkan bukti pembayaran kepada ${b(COMPANY.collectionsEmail)}.</p>
<p>Jika Tuan/Puan mendapati potongan gaji telah dibuat pada bulan yang dinyatakan, sila hantar slip gaji bagi proses semakan dari pihak kami.</p>
<p>Sekian, terima kasih.</p>
<p><em>${sign.map(esc).join('<br>')}</em></p>
</body></html>`;
  return { subject: EMAIL_SUBJECT, text, html };
}

/** An Outlook draft: double-click the .eml and Outlook opens it ready to review and Send. */
export async function outlookDraft(to: string, d: LetterData, pdf: Buffer): Promise<Buffer> {
  const e = emailBody(d);
  const mail = new MailComposer({
    to,
    subject: e.subject,
    text: e.text,
    html: e.html,
    headers: { 'X-Unsent': '1' },
    attachments: [{ filename: letterFileName(d), content: pdf, contentType: 'application/pdf' }],
  });
  return mail.compile().build();
}

export async function zip(files: Array<{ name: string; data: Buffer | string }>): Promise<Buffer> {
  const z = new JSZip();
  const used = new Set<string>();
  for (const f of files) {
    let name = f.name;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = f.name.replace(/(\.[^.]+)$/, `_${i}$1`);
    used.add(name.toLowerCase());
    z.file(name, f.data);
  }
  return z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
