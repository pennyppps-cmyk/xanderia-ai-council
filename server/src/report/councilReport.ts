import { createRequire } from 'node:module';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import type { Stance } from '../council/format.js';
import type { Verdict } from '../llm/schemas.js';

/** Everything the report needs, already loaded and access-checked by the caller. */
export interface ReportData {
  title: string;
  question: string;
  askedBy: string;
  department: { name: string; reviewBeforeActing: boolean };
  createdAt: Date;
  completedAt: Date | null;
  mode: 'quick' | 'council';
  cloudUsed: boolean;
  intent?: string | null;
  verdict: Verdict | null;
  /** Quick-mode answer, or the Chairman's raw text when the verdict failed validation. */
  content: string;
  opinions: Array<{ key: string; name: string; content: string; stance: Stance | null }>;
  reviews: Array<{ reviewerKey: string; reviewerName: string; scores: Record<string, { score: number; flaw: string }> }>;
  citations: Array<{ id: string; title: string; section: string | null }>;
}

// ── Palette (matches the web app) ────────────────────────────────────────────
const C = {
  ink: '#0f2a3d',
  ink2: '#3b556a',
  muted: '#7890a3',
  line: '#e3eaef',
  bg: '#f3f6f8',
  teal: '#0d9488',
  tealLight: '#5eead4',
  tealBg: '#effcf9',
  green: '#16a34a',
  greenBg: '#dcfce7',
  amber: '#d97706',
  amberBg: '#fef3c7',
  red: '#dc2626',
  redBg: '#fee2e2',
  gray: '#94a3b8',
};
const STANCE_COLOR: Record<string, string> = { for: C.green, conditional: C.amber, against: C.red, unclear: C.gray };
const STANCE_LABEL: Record<string, string> = { for: 'For', conditional: 'Conditional', against: 'Against', unclear: 'Unclear' };
const LEVELS = ['low', 'medium', 'high'] as const;

const require = createRequire(import.meta.url);
const fontDir = path.join(path.dirname(require.resolve('@fontsource/inter/package.json')), 'files');
const FONT = {
  regular: path.join(fontDir, 'inter-latin-400-normal.woff'),
  semibold: path.join(fontDir, 'inter-latin-600-normal.woff'),
  bold: path.join(fontDir, 'inter-latin-700-normal.woff'),
};

const PAGE = { w: 595.28, h: 841.89, m: 48 };
const W = PAGE.w - PAGE.m * 2;
const BOTTOM = PAGE.h - PAGE.m - 18; // leave room for the footer

type Doc = PDFKit.PDFDocument;

// ── Text helpers ─────────────────────────────────────────────────────────────

const REPLACEMENTS: Record<string, string> = { '→': '->', '←': '<-', '≈': '~', '≥': '>=', '≤': '<=', '✓': 'v', '•': '·' };

/** Keep only characters the embedded font can draw (model output may contain emoji etc.). */
function clean(doc: Doc, text: string): string {
  const font = (doc as any)._font?.font;
  let out = '';
  for (const ch of text ?? '') {
    const cp = ch.codePointAt(0)!;
    if (ch === '\n' || ch === '\t') out += ch;
    else if (!font?.hasGlyphForCodePoint || font.hasGlyphForCodePoint(cp)) out += ch;
    else if (REPLACEMENTS[ch]) out += REPLACEMENTS[ch];
  }
  return out;
}

function stripInline(md: string) {
  return md
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/<[^>]+>/g, '');
}

function ensure(doc: Doc, height: number) {
  if (doc.y + height > BOTTOM) doc.addPage();
}

function heading(doc: Doc, text: string, size = 13) {
  ensure(doc, size + 40);
  doc.moveDown(0.6);
  doc.font('bold').fontSize(size).fillColor(C.ink).text(clean(doc, text), PAGE.m, doc.y, { width: W });
  doc.moveDown(0.3);
}

function label(doc: Doc, text: string) {
  ensure(doc, 30);
  doc.font('bold').fontSize(7.5).fillColor(C.teal).text(clean(doc, text.toUpperCase()), PAGE.m, doc.y, { width: W, characterSpacing: 0.6 });
  doc.moveDown(0.25);
}

function para(doc: Doc, text: string, opts: { size?: number; color?: string; x?: number; width?: number } = {}) {
  const x = opts.x ?? PAGE.m;
  doc.font('regular').fontSize(opts.size ?? 9.5).fillColor(opts.color ?? C.ink2);
  doc.text(clean(doc, text), x, doc.y, { width: opts.width ?? W - (x - PAGE.m), lineGap: 2 });
}

/** Inline **bold** support on one logical line. */
function richLine(doc: Doc, text: string, x: number, width: number, size: number, color: string) {
  const parts = stripInline(text).split(/\*\*/);
  const segs = parts.map((t, i) => ({ t: clean(doc, t), bold: i % 2 === 1 })).filter((s) => s.t.length);
  if (!segs.length) return;
  segs.forEach((s, i) => {
    doc.font(s.bold ? 'semibold' : 'regular').fontSize(size).fillColor(s.bold ? C.ink : color);
    const opts = { width, lineGap: 2, continued: i < segs.length - 1 };
    if (i === 0) doc.text(s.t, x, doc.y, opts);
    else doc.text(s.t, opts);
  });
}

/** Minimal Markdown: headings, bullets, numbered lists, bold, paragraphs. */
function markdown(doc: Doc, md: string, opts: { size?: number; x?: number; width?: number } = {}) {
  const size = opts.size ?? 9.5;
  const x0 = opts.x ?? PAGE.m;
  const width = opts.width ?? W;
  for (const raw of md.replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      doc.moveDown(0.35);
      continue;
    }
    ensure(doc, size * 2.5);
    const h = /^#{1,6}\s+(.*)/.exec(line);
    const bullet = /^\s*[-*•]\s+(.*)/.exec(line);
    const num = /^\s*(\d+)[.)]\s+(.*)/.exec(line);
    if (h) {
      doc.moveDown(0.2);
      doc.font('bold').fontSize(size + 1).fillColor(C.ink).text(clean(doc, stripInline(h[1]).replace(/\*\*/g, '')), x0, doc.y, { width });
      doc.moveDown(0.15);
    } else if (bullet || num) {
      const marker = bullet ? '•' : `${num![1]}.`;
      const y = doc.y;
      doc.font('regular').fontSize(size).fillColor(C.muted).text(marker, x0 + 2, y, { width: 14 });
      doc.y = y;
      richLine(doc, bullet ? bullet[1] : num![2], x0 + 16, width - 16, size, C.ink2);
    } else {
      richLine(doc, line, x0, width, size, C.ink2);
    }
  }
}

function pill(doc: Doc, x: number, y: number, text: string, fg: string, bg: string, size = 7.5) {
  doc.font('semibold').fontSize(size);
  const w = doc.widthOfString(text) + 12;
  doc.roundedRect(x, y, w, size + 7, (size + 7) / 2).fill(bg);
  doc.fillColor(fg).text(text, x + 6, y + 3.2, { lineBreak: false });
  return w;
}

// ── Sections ─────────────────────────────────────────────────────────────────

function cover(doc: Doc, d: ReportData) {
  doc.rect(0, 0, PAGE.w, 150).fill(C.ink);
  // logo: three linked nodes
  const lx = PAGE.m + 12;
  const ly = 44;
  doc.lineWidth(1.4).strokeColor(C.tealLight);
  doc.moveTo(lx, ly + 3).lineTo(lx, ly + 9).stroke();
  doc.moveTo(lx - 7, ly + 14).lineTo(lx - 1, ly + 9).stroke();
  doc.moveTo(lx + 7, ly + 14).lineTo(lx + 1, ly + 9).stroke();
  doc.fillColor(C.tealLight);
  doc.circle(lx, ly, 3.6).fill();
  doc.circle(lx - 9, ly + 16, 3.6).fill();
  doc.circle(lx + 9, ly + 16, 3.6).fill();
  doc.font('semibold').fontSize(10).fillColor('#cdf6ee').text('Xanderia AI Council', lx + 22, ly - 2, { lineBreak: false });
  doc.font('regular').fontSize(8.5).fillColor('#c7d4de').text(d.mode === 'council' ? 'Council report' : 'Advisory answer', lx + 22, ly + 12, { lineBreak: false });

  doc.font('bold').fontSize(19).fillColor('#ffffff').text(clean(doc, d.title), PAGE.m, 84, { width: W, height: 48, ellipsis: true });
  const meta = [
    d.department.name,
    `asked by ${d.askedBy}`,
    d.createdAt.toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur' }),
    d.intent ? d.intent : null,
  ].filter(Boolean).join('  ·  ');
  doc.font('regular').fontSize(8.5).fillColor('#c7d4de').text(clean(doc, meta), PAGE.m, 128, { width: W, lineBreak: false });

  doc.y = 166;
  let x = PAGE.m;
  if (!d.cloudUsed) x += pill(doc, x, doc.y, 'Processed on-premises', '#047857', '#d1fae5') + 6;
  if (d.department.reviewBeforeActing) x += pill(doc, x, doc.y, 'Review before acting', C.red, C.redBg) + 6;
  pill(doc, x, doc.y, 'Advisory output only', C.ink2, C.bg);
  doc.y += 26;

  label(doc, 'The question');
  const q = d.question.length > 1400 ? `${d.question.slice(0, 1400)}…` : d.question;
  doc.font('regular').fontSize(9.5);
  const qh = doc.heightOfString(clean(doc, q), { width: W - 24, lineGap: 2 }) + 20;
  ensure(doc, qh);
  const qy = doc.y;
  doc.rect(PAGE.m, qy, W, qh).fill(C.bg);
  doc.rect(PAGE.m, qy, 3, qh).fill(C.teal);
  doc.fillColor(C.ink).text(clean(doc, q), PAGE.m + 14, qy + 10, { width: W - 24, lineGap: 2 });
  doc.y = qy + qh + 12;
}

function kpiTiles(doc: Doc, d: ReportData, v: Verdict) {
  const stances = d.opinions.map((o) => o.stance?.value ?? 'unclear');
  const count = (s: string) => stances.filter((x) => x === s).length;
  const highImpact = v.risks.filter((r) => r.impact === 'high').length;
  const weeks = planWeeks(v).reduce((m, s) => Math.max(m, s.start + s.duration - 1), 0);
  const tiles = [
    { big: `${count('for')} · ${count('conditional')} · ${count('against')}`, small: 'Advisors for · conditional · against' },
    { big: String(v.risks.length), small: highImpact ? `Risks (${highImpact} high impact)` : 'Risks identified' },
    { big: String(v.action_plan.length), small: weeks ? `Action steps over ~${weeks} weeks` : 'Action steps' },
    { big: cap(v.confidence.level), small: 'Chairman confidence' },
  ];
  ensure(doc, 60);
  const gap = 8;
  const tw = (W - gap * 3) / 4;
  const y = doc.y;
  tiles.forEach((t, i) => {
    const x = PAGE.m + i * (tw + gap);
    doc.roundedRect(x, y, tw, 50, 6).fill(C.bg);
    doc.font('bold').fontSize(15).fillColor(i === 3 ? confidenceColor(v.confidence.level) : C.ink).text(t.big, x + 10, y + 9, { width: tw - 20, lineBreak: false });
    doc.font('regular').fontSize(7.2).fillColor(C.muted).text(t.small, x + 10, y + 32, { width: tw - 20, lineBreak: false, ellipsis: true });
  });
  doc.y = y + 62;
}

function verdictBlock(doc: Doc, v: Verdict) {
  label(doc, "Chairman's verdict");
  doc.font('semibold').fontSize(11.5);
  const text = clean(doc, v.verdict);
  const h = doc.heightOfString(text, { width: W - 28, lineGap: 3 }) + 26;
  ensure(doc, h);
  const y = doc.y;
  doc.roundedRect(PAGE.m, y, W, h, 8).fill(C.ink);
  doc.fillColor('#ffffff').text(text, PAGE.m + 14, y + 13, { width: W - 28, lineGap: 3 });
  doc.y = y + h + 12;
}

function confidenceGauge(doc: Doc, v: Verdict) {
  ensure(doc, 70);
  label(doc, 'Confidence');
  const y = doc.y;
  const segW = 70;
  LEVELS.forEach((lvl, i) => {
    const active = lvl === v.confidence.level;
    const color = active ? confidenceColor(lvl) : C.line;
    doc.roundedRect(PAGE.m + i * (segW + 4), y, segW, 16, 3).fill(color);
    doc.font('semibold').fontSize(7.5).fillColor(active ? '#ffffff' : C.muted).text(cap(lvl), PAGE.m + i * (segW + 4), y + 4.5, { width: segW, align: 'center', lineBreak: false });
  });
  doc.y = y;
  para(doc, `What would change this recommendation: ${v.confidence.what_would_change}`, { x: PAGE.m + 3 * (segW + 4) + 10, size: 8.5 });
  doc.y = Math.max(doc.y, y + 22) + 8;
}

function stanceMap(doc: Doc, d: ReportData) {
  heading(doc, 'Where the advisors stand');
  para(doc, "Each advisor's own declared stance and conviction, before the Chairman's ruling.", { size: 8.5, color: C.muted });
  doc.moveDown(0.5);

  // Distribution bar
  const total = d.opinions.length || 1;
  const order = ['for', 'conditional', 'against', 'unclear'];
  const counts = order.map((s) => d.opinions.filter((o) => (o.stance?.value ?? 'unclear') === s).length);
  ensure(doc, 40);
  let x = PAGE.m;
  const y = doc.y;
  counts.forEach((n, i) => {
    if (!n) return;
    const w = (n / total) * W;
    doc.rect(x, y, w, 14).fill(STANCE_COLOR[order[i]]);
    doc.font('semibold').fontSize(7.5).fillColor('#ffffff').text(`${STANCE_LABEL[order[i]]} ${n}`, x + 5, y + 3.5, { width: w - 8, lineBreak: false, ellipsis: true });
    x += w;
  });
  doc.y = y + 24;

  for (const o of d.opinions) {
    const s = o.stance ?? { value: 'unclear', strength: null, position: null };
    doc.font('regular').fontSize(8.3);
    const pos = clean(doc, s.position ?? '(no position line)');
    const ph = Math.min(doc.heightOfString(pos, { width: W - 250, lineGap: 1.5 }), 34);
    const rowH = Math.max(28, ph + 12);
    ensure(doc, rowH);
    const ry = doc.y;
    doc.font('semibold').fontSize(9).fillColor(C.ink).text(clean(doc, o.name), PAGE.m, ry + 6, { width: 118, lineBreak: false, ellipsis: true });
    pill(doc, PAGE.m + 122, ry + 5, STANCE_LABEL[s.value], '#ffffff', STANCE_COLOR[s.value], 7);
    // conviction dots
    for (let i = 1; i <= 5; i++) {
      doc.circle(PAGE.m + 200 + i * 8, ry + 11, 2.6).fill(s.strength && i <= s.strength ? STANCE_COLOR[s.value] : C.line);
    }
    doc.font('regular').fontSize(8.3).fillColor(C.ink2).text(pos, PAGE.m + 250, ry + 5, { width: W - 250, height: 34, lineGap: 1.5, ellipsis: true });
    doc.moveTo(PAGE.m, ry + rowH).lineTo(PAGE.m + W, ry + rowH).lineWidth(0.4).strokeColor(C.line).stroke();
    doc.y = ry + rowH + 2;
  }
  para(doc, 'Dots show each advisor\'s self-rated conviction (1-5).', { size: 7.5, color: C.muted });
}

function peerChart(doc: Doc, d: ReportData) {
  heading(doc, 'Peer review scores');
  if (!d.reviews.length) {
    para(doc, 'Peer review was not run for this question (it is optional and off by default).', { size: 8.5, color: C.muted });
    return;
  }
  para(doc, 'Average score each advisor received from the others, who reviewed anonymously (1-5).', { size: 8.5, color: C.muted });
  doc.moveDown(0.5);
  const avg = d.opinions
    .map((o) => {
      const scores = d.reviews.map((r) => r.scores[o.key]?.score).filter((n): n is number => typeof n === 'number');
      return { name: o.name, avg: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null, n: scores.length };
    })
    .sort((a, b) => (b.avg ?? 0) - (a.avg ?? 0));
  const barX = PAGE.m + 130;
  const barW = W - 170;
  for (const a of avg) {
    ensure(doc, 20);
    const y = doc.y;
    doc.font('regular').fontSize(8.5).fillColor(C.ink).text(clean(doc, a.name), PAGE.m, y + 2, { width: 125, lineBreak: false, ellipsis: true });
    doc.rect(barX, y + 1, barW, 11).fill(C.bg);
    if (a.avg !== null) {
      const color = a.avg >= 3.5 ? C.green : a.avg >= 2.5 ? C.amber : C.red;
      doc.rect(barX, y + 1, (a.avg / 5) * barW, 11).fill(color);
      doc.font('semibold').fontSize(8).fillColor(C.ink).text(`${a.avg.toFixed(1)}`, barX + barW + 6, y + 2, { lineBreak: false });
    }
    doc.y = y + 17;
  }
  // scale
  const y = doc.y;
  for (let i = 0; i <= 5; i++) {
    const x = barX + (i / 5) * barW;
    doc.font('regular').fontSize(6.5).fillColor(C.muted).text(String(i), x - 2, y, { lineBreak: false });
  }
  doc.y = y + 14;
}

function riskHeatMap(doc: Doc, v: Verdict) {
  heading(doc, 'Risk heat map');
  const rated = v.risks.filter((r) => r.likelihood && r.impact);
  if (!v.risks.length) {
    para(doc, 'The Chairman identified no specific risks.', { size: 8.5, color: C.muted });
    return;
  }
  if (!rated.length) {
    para(doc, 'Risk ratings are not available for this verdict (it was generated before ratings were added).', { size: 8.5, color: C.muted });
  } else {
    para(doc, 'Each numbered dot is a risk from the verdict, placed by the Chairman\'s likelihood and impact rating.', { size: 8.5, color: C.muted });
    doc.moveDown(0.5);
    const cell = { w: 78, h: 44 };
    const gx = PAGE.m + 50;
    ensure(doc, cell.h * 3 + 40);
    const gy = doc.y;
    const tone = (li: number, ii: number) => {
      const score = li + ii; // 0..4
      return score >= 3 ? C.redBg : score === 2 ? C.amberBg : C.greenBg;
    };
    for (let ii = 0; ii < 3; ii++) {
      for (let li = 0; li < 3; li++) {
        const x = gx + li * cell.w;
        const y = gy + (2 - ii) * cell.h;
        doc.rect(x, y, cell.w - 2, cell.h - 2).fill(tone(li, ii));
      }
    }
    // axes
    doc.font('semibold').fontSize(7).fillColor(C.muted);
    LEVELS.forEach((lvl, i) => {
      doc.text(cap(lvl), gx + i * cell.w, gy + 3 * cell.h + 2, { width: cell.w - 2, align: 'center', lineBreak: false });
      doc.text(cap(lvl), PAGE.m, gy + (2 - i) * cell.h + cell.h / 2 - 5, { width: 44, align: 'right', lineBreak: false });
    });
    doc.text('Likelihood', gx, gy + 3 * cell.h + 12, { width: cell.w * 3, align: 'center', lineBreak: false });
    doc.save();
    doc.rotate(-90, { origin: [PAGE.m + 6, gy + cell.h * 1.5] });
    doc.text('Impact', PAGE.m - 20, gy + cell.h * 1.5 - 4, { width: 60, align: 'center', lineBreak: false });
    doc.restore();

    // dots
    const perCell = new Map<string, number>();
    v.risks.forEach((r, idx) => {
      if (!r.likelihood || !r.impact) return;
      const li = LEVELS.indexOf(r.likelihood);
      const ii = LEVELS.indexOf(r.impact);
      const key = `${li}:${ii}`;
      const k = perCell.get(key) ?? 0;
      perCell.set(key, k + 1);
      const cx = gx + li * cell.w + 14 + (k % 4) * 17;
      const cy = gy + (2 - ii) * cell.h + 14 + Math.floor(k / 4) * 17;
      doc.circle(cx, cy, 7).fill(C.ink);
      doc.font('bold').fontSize(7).fillColor('#ffffff').text(String(idx + 1), cx - 7, cy - 3.6, { width: 14, align: 'center', lineBreak: false });
    });
    doc.y = gy + 3 * cell.h + 30;
  }

  // Legend table
  for (const [idx, r] of v.risks.entries()) {
    doc.font('regular').fontSize(8.5);
    const text = clean(doc, r.risk);
    const mit = clean(doc, r.mitigation);
    const h = Math.max(doc.heightOfString(text, { width: 190 }), doc.heightOfString(mit, { width: W - 300 })) + 10;
    ensure(doc, h);
    const y = doc.y;
    doc.circle(PAGE.m + 7, y + 7, 6.5).fill(C.ink);
    doc.font('bold').fontSize(7).fillColor('#ffffff').text(String(idx + 1), PAGE.m, y + 3.6, { width: 14, align: 'center', lineBreak: false });
    doc.font('semibold').fontSize(8.5).fillColor(C.ink).text(text, PAGE.m + 20, y + 2, { width: 190 });
    if (r.likelihood) {
      const rating = `L ${cap(r.likelihood)} · I ${cap(r.impact)}`;
      const sev = LEVELS.indexOf(r.likelihood) + LEVELS.indexOf(r.impact);
      pill(doc, PAGE.m + 214, y + 1, rating, sev >= 3 ? C.red : sev === 2 ? C.amber : C.green, sev >= 3 ? C.redBg : sev === 2 ? C.amberBg : C.greenBg, 6.5);
    }
    doc.font('regular').fontSize(8.5).fillColor(C.ink2).text(mit, PAGE.m + 300, y + 2, { width: W - 300 });
    doc.y = y + h;
    doc.moveTo(PAGE.m, doc.y).lineTo(PAGE.m + W, doc.y).lineWidth(0.4).strokeColor(C.line).stroke();
    doc.y += 3;
  }
}

/** Numeric schedule per step; older verdicts without start_week are parsed from their timeline text. */
export function planWeeks(v: Verdict) {
  let cursor = 1;
  return v.action_plan.map((s) => {
    let start = s.start_week;
    let duration = s.duration_weeks;
    if (!start) {
      const t = s.timeline.toLowerCase();
      const week = /week\s*(\d+)/.exec(t);
      const days = /(\d+)\s*(?:days|hari)/.exec(t);
      const months = /(\d+)\s*(?:months?|bulan)/.exec(t);
      if (week) start = Number(week[1]);
      else if (days) start = Math.max(1, Math.ceil(Number(days[1]) / 7) - 1);
      else if (months) start = Math.max(1, Number(months[1]) * 4 - 2);
      else start = cursor;
      duration = duration || (days ? Math.max(1, Math.ceil(Number(days[1]) / 7) - start + 1) : months ? 3 : 2);
    }
    duration = Math.max(1, duration || 1);
    cursor = Math.max(cursor, start + duration);
    return { start, duration };
  });
}

function timeline(doc: Doc, v: Verdict) {
  heading(doc, 'Action plan timeline');
  const weeks = planWeeks(v);
  const maxWeek = Math.max(4, ...weeks.map((w) => w.start + w.duration - 1));
  const labelW = 190;
  const chartX = PAGE.m + labelW + 10;
  const chartW = W - labelW - 10;
  const scale = (wk: number) => chartX + ((wk - 1) / maxWeek) * chartW;
  const tickEvery = maxWeek <= 8 ? 1 : maxWeek <= 16 ? 2 : maxWeek <= 32 ? 4 : 8;

  ensure(doc, 40);
  // header ticks
  const hy = doc.y;
  for (let wk = 1; wk <= maxWeek + 1; wk += tickEvery) {
    const x = scale(wk);
    doc.font('regular').fontSize(6.5).fillColor(C.muted).text(`W${wk}`, x - 1, hy, { lineBreak: false });
  }
  doc.y = hy + 12;

  v.action_plan.forEach((s, i) => {
    doc.font('regular').fontSize(8.3);
    const text = clean(doc, `${i + 1}. ${s.step}`);
    const th = Math.min(doc.heightOfString(text, { width: labelW, lineGap: 1 }), 32);
    const rowH = Math.max(30, th + 16);
    ensure(doc, rowH);
    const y = doc.y;
    // grid lines
    for (let wk = 1; wk <= maxWeek + 1; wk += tickEvery) {
      doc.moveTo(scale(wk), y).lineTo(scale(wk), y + rowH).lineWidth(0.3).strokeColor(C.line).stroke();
    }
    doc.fillColor(C.ink).text(text, PAGE.m, y + 3, { width: labelW, height: 32, lineGap: 1, ellipsis: true });
    doc.font('regular').fontSize(7).fillColor(C.muted).text(clean(doc, s.owner_role), PAGE.m, y + rowH - 11, { width: labelW, lineBreak: false, ellipsis: true });
    const { start, duration } = weeks[i];
    const bx = scale(start);
    const bw = Math.max(6, scale(start + duration) - bx);
    doc.roundedRect(bx, y + 7, bw, 13, 3).fill(i % 2 ? C.teal : C.ink);
    doc.font('semibold').fontSize(6.8);
    const tl = clean(doc, s.timeline);
    const tw = doc.widthOfString(tl);
    if (tw + 8 < bw) doc.fillColor('#ffffff').text(tl, bx + 4, y + 10.5, { lineBreak: false });
    else if (bx + bw + tw + 6 < PAGE.m + W) doc.fillColor(C.ink2).text(tl, bx + bw + 4, y + 10.5, { lineBreak: false });
    doc.moveTo(PAGE.m, y + rowH).lineTo(PAGE.m + W, y + rowH).lineWidth(0.4).strokeColor(C.line).stroke();
    doc.y = y + rowH + 1;
  });
  para(doc, 'W = week from the start of the plan. Bars show when each step starts and how long the Chairman expects it to take.', { size: 7.5, color: C.muted });
}

function conflicts(doc: Doc, v: Verdict) {
  if (!v.conflicts.length) return;
  heading(doc, 'Disagreements resolved');
  for (const c of v.conflicts) {
    ensure(doc, 70);
    doc.font('semibold').fontSize(8.5).fillColor(C.teal).text(clean(doc, c.between), PAGE.m, doc.y, { width: W });
    doc.moveDown(0.15);
    const y = doc.y;
    const colW = (W - 12) / 2;
    doc.font('regular').fontSize(8.5).fillColor(C.ink2);
    doc.text(clean(doc, `A: ${c.position_a}`), PAGE.m, y, { width: colW, lineGap: 1.5 });
    const ya = doc.y;
    doc.text(clean(doc, `B: ${c.position_b}`), PAGE.m + colW + 12, y, { width: colW, lineGap: 1.5 });
    doc.y = Math.max(ya, doc.y) + 3;
    richLine(doc, `**Decision:** ${c.decision} **Because:** ${c.because.replace(/^because\s+/i, '')}`, PAGE.m, W, 8.8, C.ink2);
    doc.moveDown(0.7);
  }
}

function listSection(doc: Doc, title: string, items: string[]) {
  if (!items.length) return;
  heading(doc, title);
  markdown(doc, items.map((i) => `- ${i}`).join('\n'), { size: 9 });
}

function appendix(doc: Doc, d: ReportData) {
  if (!d.opinions.length) return;
  doc.addPage();
  doc.font('bold').fontSize(16).fillColor(C.ink).text('Appendix: advisor opinions', PAGE.m, doc.y, { width: W });
  para(doc, 'Each advisor answered independently, before seeing the others. Reproduced as written by the model.', { size: 8.5, color: C.muted });
  for (const o of d.opinions) {
    ensure(doc, 80);
    doc.moveDown(0.8);
    const y = doc.y;
    doc.rect(PAGE.m, y, W, 20).fill(C.bg);
    doc.font('bold').fontSize(10).fillColor(C.ink).text(clean(doc, o.name), PAGE.m + 8, y + 5, { lineBreak: false });
    if (o.stance) pill(doc, PAGE.m + W - 90, y + 4, `${STANCE_LABEL[o.stance.value]}${o.stance.strength ? ` ${o.stance.strength}/5` : ''}`, '#ffffff', STANCE_COLOR[o.stance.value], 7);
    doc.y = y + 26;
    markdown(doc, o.content || '_(no opinion: this advisor was unavailable)_', { size: 8.8 });
    const flaws = d.reviews.map((r) => ({ by: r.reviewerName, s: r.scores[o.key] })).filter((f) => f.s);
    if (flaws.length) {
      doc.moveDown(0.3);
      label(doc, 'What the other advisors said (anonymised review)');
      for (const f of flaws) {
        ensure(doc, 24);
        richLine(doc, `**${f.s!.score}/5** · ${f.s!.flaw}`, PAGE.m + 8, W - 8, 8, C.ink2);
        doc.moveDown(0.2);
      }
    }
  }
}

function citations(doc: Doc, d: ReportData) {
  if (!d.citations.length) return;
  heading(doc, 'Sources from the knowledge base', 11);
  for (const c of d.citations) {
    ensure(doc, 16);
    para(doc, `[${c.id}] ${c.title}${c.section ? ` › ${c.section}` : ''}`, { size: 8.5 });
  }
}

function footers(doc: Doc, d: ReportData) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Writing inside the bottom margin would make pdfkit start a new page.
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = PAGE.h - PAGE.m + 8;
    doc.moveTo(PAGE.m, y - 6).lineTo(PAGE.m + W, y - 6).lineWidth(0.4).strokeColor(C.line).stroke();
    doc.font('regular').fontSize(7).fillColor(C.muted);
    doc.text(
      `Xanderia AI Council · ${d.mode === 'council' ? 'Council report' : 'Advisory answer'} · Internal · Advisory output only: final decisions sit with the responsible staff and management.`,
      PAGE.m,
      y,
      { width: W - 60, lineBreak: false, ellipsis: true },
    );
    doc.text(`${i + 1} / ${range.count}`, PAGE.m + W - 50, y, { width: 50, align: 'right', lineBreak: false });
    doc.page.margins.bottom = savedBottom;
  }
}

function cap(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function confidenceColor(level: string) {
  return level === 'high' ? C.green : level === 'medium' ? C.amber : C.red;
}

// ── Entry point ──────────────────────────────────────────────────────────────

export function renderReport(d: ReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: PAGE.m, bottom: PAGE.m, left: PAGE.m, right: PAGE.m },
      bufferPages: true,
      info: {
        Title: `Xanderia AI Council: ${d.title}`,
        Author: 'Xanderia AI Council',
        Subject: d.mode === 'council' ? 'Council report' : 'Advisory answer',
        Creator: 'Xanderia AI Council',
      },
    });
    doc.registerFont('regular', FONT.regular);
    doc.registerFont('semibold', FONT.semibold);
    doc.registerFont('bold', FONT.bold);
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      doc.font('regular');
      cover(doc, d);
      const v = d.mode === 'council' ? d.verdict : null;
      if (v) {
        verdictBlock(doc, v);
        kpiTiles(doc, d, v);
        confidenceGauge(doc, v);
        heading(doc, 'Why');
        para(doc, v.why);

        // Sections flow; a chart only moves to a new page when it would not fit.
        doc.moveDown(0.8);
        ensure(doc, 260);
        doc.font('bold').fontSize(16).fillColor(C.ink).text('Analytics', PAGE.m, doc.y, { width: W });
        stanceMap(doc, d);
        ensure(doc, 150);
        peerChart(doc, d);
        ensure(doc, 250);
        riskHeatMap(doc, v);
        timeline(doc, v);
        conflicts(doc, v);
        listSection(doc, 'Open questions to answer before acting', v.open_questions);
        citations(doc, d);
        appendix(doc, d);
      } else {
        heading(doc, d.mode === 'council' ? "Chairman's answer" : 'Answer');
        if (d.mode === 'council') {
          para(doc, "The Chairman's answer did not match the structured format, so charts are not available; the text is shown as written.", { size: 8.5, color: C.amber });
          doc.moveDown(0.4);
        }
        markdown(doc, d.content || '(no answer)');
        citations(doc, d);
        if (d.mode === 'council') appendix(doc, d);
      }
      footers(doc, d);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
