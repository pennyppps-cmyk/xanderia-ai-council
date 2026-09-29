import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../auth';
import { getLang, tl } from '../i18n';
import type { LivePart, LiveState } from '../useMessageStream';
import { cx, Icon } from './ui';

/**
 * The council room: the advisors as pixel characters round a table, "talking out" the council as it
 * runs: their positions and key points, the anonymous peer review, then the Chairman's agreements,
 * clashes, blind spots and first step. Built only from the live council stream (no extra model calls),
 * so it can replay any finished council too.
 */

type BeatKind = 'round' | 'say' | 'stance' | 'review' | 'missed' | 'agree' | 'clash' | 'insight' | 'first' | 'verdict';
interface Beat {
  id: string;
  kind: BeatKind;
  speaker?: string; // persona key, or 'chairman'
  target?: string; // the advisor reviewed, or the other side of a clash
  text: string;
  score?: number;
  ms: number;
}

// ── View preference: cards or the room ─────────────────────────────────────────
export type CouncilViewMode = 'cards' | 'room';
const VIEW_KEY = 'xc:councilView';
const VIEW_EVENT = 'xc:councilView';

export function getCouncilView(): CouncilViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === 'room' ? 'room' : 'cards';
  } catch {
    return 'cards';
  }
}

export function setCouncilView(v: CouncilViewMode) {
  try {
    localStorage.setItem(VIEW_KEY, v);
  } catch {
    /* private window: not remembered */
  }
  window.dispatchEvent(new Event(VIEW_EVENT));
}

/** The remembered choice; every answer and the composer follow a change made anywhere. */
export function useCouncilView(): CouncilViewMode {
  const [view, setView] = useState(getCouncilView);
  useEffect(() => {
    const sync = () => setView(getCouncilView());
    window.addEventListener(VIEW_EVENT, sync);
    return () => window.removeEventListener(VIEW_EVENT, sync);
  }, []);
  return view;
}

// ── Looks ─────────────────────────────────────────────────────────────────────
type Top = 'short' | 'hijab' | 'hat' | 'spiky' | 'grey' | 'hood' | 'bun';
interface Look {
  shirt: string;
  shirtDark: string;
  hair: string;
  top: Top;
  tie?: string;
  glasses?: boolean;
  badge?: string; // small glyph above the head
}
const LOOKS: Record<string, Look> = {
  contrarian: { shirt: '#d64545', shirtDark: '#9e2b2b', hair: '#2a1d17', top: 'spiky', badge: '!' },
  first_principles: { shirt: '#3d7bd9', shirtDark: '#2a5aa6', hair: '#3b2a20', top: 'short', glasses: true },
  expansionist: { shirt: '#2fa36b', shirtDark: '#1f7a4e', hair: '#6b3f1f', top: 'bun' },
  customer_advocate: { shirt: '#e0709a', shirtDark: '#b24f76', hair: '#7a4fa0', top: 'hijab' },
  executor: { shirt: '#e08a2c', shirtDark: '#b0661a', hair: '#2a1d17', top: 'hat' },
  outsider: { shirt: '#8a93a3', shirtDark: '#636b7a', hair: '#8a93a3', top: 'hood', badge: '?' },
  dept_expert: { shirt: '#243b6b', shirtDark: '#172849', hair: '#1c1c1c', top: 'short', tie: '#c9a227' },
  compliance: { shirt: '#7b52c7', shirtDark: '#5a3a99', hair: '#1f3b57', top: 'hijab', badge: '§' },
  chairman: { shirt: '#1d2230', shirtDark: '#10131b', hair: '#c9ccd3', top: 'grey', tie: '#c9a227' },
};
const SPARE = ['#3aa7a3', '#b8574a', '#5d6fd1', '#9a7b2f', '#4f8f3a'];
function lookFor(key: string): Look {
  if (LOOKS[key]) return LOOKS[key];
  const n = [...key].reduce((a, c) => a + c.charCodeAt(0), 0);
  const shirt = SPARE[n % SPARE.length];
  return { shirt, shirtDark: shirt, hair: '#2a1d17', top: 'short' };
}

const SKIN = '#e8b890';
const SKIN_DARK = '#c98f68';

/** A 10×12 seated figure: head rows depend on the look; body and face are shared. */
function spriteRows(top: Top): string[] {
  const heads: Record<Top, string[]> = {
    short: ['..hhhhhh..', '.hhhhhhhh.', '.hssssssh.'],
    grey: ['..hhhhhh..', '.hhhhhhhh.', '.hssssssh.'],
    spiky: ['.h.hh.hh..', '.hhhhhhhh.', '.hssssssh.'],
    bun: ['....hh....', '.hhhhhhhh.', '.hssssssh.'],
    hat: ['.yyyyyyyy.', 'yyyyyyyyyy', '.hssssssh.'],
    hijab: ['..hhhhhh..', '.hhhhhhhh.', 'hhsssssshh'],
    hood: ['..hhhhhh..', '.hhhhhhhh.', 'hhsssssshh'],
  };
  const sides = top === 'hijab' || top === 'hood';
  return [
    ...heads[top],
    sides ? 'hsseSSesSh' : '.sseSSess.',
    sides ? 'hssssssssh' : '.ssssssss.',
    sides ? 'hhssmmsshh' : '..ssmmss..',
    sides ? '.hhhsshhh.' : '...ssss...',
    '.cccttccc.',
    'ccccttcccc',
    'ccccttcccc',
    'dccccccccd',
    'dccccccccd',
  ];
}

function Sprite({ look, x, y, talking, scale = 2 }: { look: Look; x: number; y: number; talking: boolean; scale?: number }) {
  const rows = spriteRows(look.top);
  const color = (ch: string): string | null => {
    switch (ch) {
      case 'h':
        return look.hair;
      case 's':
      case 'S':
        return SKIN;
      case 'e':
        return '#1b1b1b';
      case 'm':
        return SKIN_DARK;
      case 'y':
        return '#f2c230';
      case 'c':
        return look.shirt;
      case 'd':
        return look.shirtDark;
      case 't':
        return look.tie ?? look.shirt;
      default:
        return null;
    }
  };
  const rects: React.ReactNode[] = [];
  rows.forEach((row, r) =>
    [...row].forEach((ch, c) => {
      const fill = color(ch);
      if (fill) rects.push(<rect key={`${r}-${c}`} x={x + c * scale} y={y + r * scale} width={scale} height={scale} fill={fill} />);
    }),
  );
  return (
    <g className={cx(talking && 'room-bob')}>
      {rects}
      {look.glasses && (
        <g fill="none" stroke="#1b1b1b" strokeWidth={scale * 0.5}>
          <rect x={x + 2 * scale} y={y + 3 * scale - scale * 0.25} width={scale * 2.5} height={scale * 1.5} />
          <rect x={x + 5.5 * scale} y={y + 3 * scale - scale * 0.25} width={scale * 2.5} height={scale * 1.5} />
        </g>
      )}
      {/* Open mouth, shown on alternate frames while talking. */}
      {talking && <rect className="room-mouth" x={x + 4 * scale} y={y + 5 * scale} width={2 * scale} height={scale} fill="#6b2a2a" />}
    </g>
  );
}

// ── The script ───────────────────────────────────────────────────────────────
const clip = (s: string, n = 230) => {
  const t = s.replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : t;
};
const readMs = (text: string) => Math.min(7000, 1600 + text.length * 32);

/** Position, up to three key points and the stance from an advisor's Markdown opinion. */
function opinionLines(text: string) {
  const plain = text.replace(/\r/g, '');
  const position = /Position:\**\s*(.+)/i.exec(plain)?.[1];
  const points = [...plain.matchAll(/^\s*(?:[-*•]|\d+\.)\s+(.+)$/gm)].map((m) => m[1]).slice(0, 3);
  const rec = /Recommendation:\**\s*(.+)/i.exec(plain)?.[1];
  const lines = [position, ...points, rec].filter((l): l is string => Boolean(l && l.trim()));
  // Free-form answer: its first two sentences.
  if (!lines.length) return (plain.match(/[^.!?\n]+[.!?]/g) ?? [plain]).slice(0, 2);
  return lines;
}

const STANCE_WORD: Record<string, string> = { for: 'For', conditional: 'Conditional', against: 'Against', unclear: 'Undecided' };

function buildBeats(live: LiveState, seatKeys: string[], nameOf: (k: string) => string): Beat[] {
  const beats: Beat[] = [];
  const parts = Object.values(live.parts);
  const opinions = parts.filter((p) => p.stage === 1);
  const reviews = parts.filter((p) => p.stage === 2);
  const push = (b: Omit<Beat, 'ms'> & { ms?: number }) => beats.push({ ms: readMs(b.text), ...b });

  if (opinions.length) push({ id: 'round1', kind: 'round', text: tl('Round 1 · Each advisor gives an opinion'), ms: 1800 });
  for (const p of opinions.filter((o) => o.done && !o.error && o.text)) {
    opinionLines(p.text).forEach((line, i) => push({ id: `s1:${p.persona}:${i}`, kind: 'say', speaker: p.persona, text: clip(line) }));
    const st = p.data?.stance as { value: string; strength: number | null } | undefined;
    if (st && st.value !== 'unclear') {
      push({ id: `s1:${p.persona}:stance`, kind: 'stance', speaker: p.persona, text: `${tl(STANCE_WORD[st.value])}${st.strength ? `, ${st.strength}/5` : ''}`, ms: 1500 });
    }
  }

  if (reviews.length) push({ id: 'round2', kind: 'round', text: tl('Round 2 · Anonymous peer review'), ms: 1800 });
  for (const r of reviews.filter((x) => x.done && !x.error)) {
    const scores = (r.data?.scores ?? {}) as Record<string, { score: number; flaw: string }>;
    Object.entries(scores)
      .sort((a, b) => a[1].score - b[1].score)
      .slice(0, 2)
      .forEach(([target, s]) =>
        push({ id: `s2:${r.persona}:${target}`, kind: 'review', speaker: r.persona, target, score: s.score, text: clip(`${nameOf(target)}: ${s.flaw}`) }),
      );
    const missed = r.data?.parsed?.all_missed as string | undefined;
    if (missed && !/^nothing\b/i.test(missed.trim())) push({ id: `s2:${r.persona}:missed`, kind: 'missed', speaker: r.persona, text: clip(`${tl('We all missed:')} ${missed}`) });
  }

  const chair = live.parts.chairman;
  if (chair || live.verdict) push({ id: 'round3', kind: 'round', text: tl('Round 3 · The Chairman decides'), ms: 1800 });
  const v = live.verdict;
  if (v) {
    (v.agreements ?? []).forEach((a, i) => push({ id: `v:agree:${i}`, kind: 'agree', speaker: 'chairman', text: clip(`${tl('We agree:')} ${a}`) }));
    v.conflicts.forEach((c, i) => {
      const between = c.between.toLowerCase();
      const sides = seatKeys.filter((k) => between.includes(nameOf(k).replace(/^(the|si)\s+/i, '').toLowerCase()) || between.includes(k.replace(/_/g, ' ')));
      push({ id: `v:clash:${i}:a`, kind: 'clash', speaker: sides[0] ?? 'chairman', target: sides[1], text: clip(c.position_a) });
      if (sides[1]) push({ id: `v:clash:${i}:b`, kind: 'clash', speaker: sides[1], target: sides[0], text: clip(c.position_b) });
      push({ id: `v:clash:${i}:rule`, kind: 'say', speaker: 'chairman', text: clip(`${tl('I rule:')} ${c.decision.replace(/[.\s]+$/, '')} (${c.because.replace(/^because\s+/i, '').replace(/[.\s]+$/, '')}).`) });
    });
    (v.blind_spots ?? []).forEach((b, i) => push({ id: `v:blind:${i}`, kind: 'insight', speaker: 'chairman', text: clip(`${tl('Blind spot:')} ${b}`) }));
    push({ id: 'v:verdict', kind: 'verdict', speaker: 'chairman', text: clip(v.verdict, 300), ms: readMs(v.verdict) + 800 });
    if (v.first_step) push({ id: 'v:first', kind: 'first', speaker: 'chairman', text: clip(`${tl('First step:')} ${v.first_step}`) });
  }
  return beats;
}

/** Short names for the table name plates. */
const PLATES: Record<string, string> = {
  contrarian: 'Contrarian', first_principles: '1st Princ.', expansionist: 'Expansion', customer_advocate: 'Customer',
  executor: 'Executor', outsider: 'Outsider', dept_expert: 'Expert', compliance: 'Compliance',
};
const PLATES_MS: Record<string, string> = {
  contrarian: 'Penentang', first_principles: 'Prinsip', expansionist: 'Peluas', customer_advocate: 'Pelanggan',
  executor: 'Pelaksana', outsider: 'Org Luar', dept_expert: 'Pakar', compliance: 'Pematuhan',
};

// ── The room ────────────────────────────────────────────────────────────────
const W = 240;
const H = 100;
const TABLE_Y = 70;
const SPRITE_Y = 46;

export function CouncilRoom({ live }: { live: LiveState }) {
  const { personas } = useAuth();
  const nameOf = (key: string) => (key === 'chairman' ? tl('The Chairman') : (getLang() === 'ms' && personas[key]?.name_ms) || personas[key]?.name || key);
  const plate = (key: string) => (getLang() === 'ms' ? PLATES_MS : PLATES)[key] ?? nameOf(key).replace(/^(The|Si)\s+/i, '').split(/\s+/)[0].slice(0, 10);
  const seatKeys = useMemo(() => {
    const keys = Object.values(live.parts).filter((p) => p.stage === 1).map((p) => p.persona);
    return [...new Set(keys)];
  }, [live.parts]);

  // Append-only script, so a beat added while the council runs never shifts what is playing.
  const script = useRef<Beat[]>([]);
  const seen = useRef(new Set<string>());
  const beats = useMemo(() => {
    for (const b of buildBeats(live, seatKeys, nameOf)) {
      if (!seen.current.has(b.id)) {
        seen.current.add(b.id);
        script.current.push(b);
      }
    }
    return [...script.current];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, seatKeys, personas]);

  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  useEffect(() => {
    if (!playing || index >= beats.length) return;
    const t = window.setTimeout(() => setIndex((i) => i + 1), beats[index].ms / speed);
    return () => window.clearTimeout(t);
  }, [index, playing, beats, speed]);

  const running = live.status !== 'done';
  const caughtUp = index >= beats.length;
  // After the last beat of a finished council, the verdict stays on screen.
  const beat = caughtUp ? (running ? undefined : beats[beats.length - 1]) : beats[index];
  const roundBanner = [...beats.slice(0, Math.min(index + 1, beats.length))].reverse().find((b) => b.kind === 'round')?.text;

  // Seats: advisors along the back of the table, the Chairman at the head on the right.
  const n = Math.max(1, seatKeys.length);
  const span = 176;
  const seatX = (i: number) => 14 + (n === 1 ? span / 2 : (i * span) / (n - 1)) - 10;
  const chairX = 208;
  const posOf = (key?: string) => {
    if (!key) return null;
    if (key === 'chairman') return { x: chairX + 10, y: SPRITE_Y - 6 };
    const i = seatKeys.indexOf(key);
    return i < 0 ? null : { x: seatX(i) + 10, y: SPRITE_Y };
  };

  // Who is still thinking (live), and who is talking now.
  const thinking = new Set<string>();
  if (running && caughtUp) {
    for (const p of Object.values(live.parts)) if (!p.done && (p.stage === 1 || p.stage === 2)) thinking.add(p.persona);
    if (live.stage === 'stage3') thinking.add('chairman');
    if (!Object.keys(live.parts).length) seatKeys.forEach((k) => thinking.add(k));
  }
  const speaker = beat && beat.kind !== 'round' ? beat.speaker : undefined;
  const agreeing = beat?.kind === 'agree';
  const me = posOf(speaker);
  const them = posOf(beat?.target);

  const lastSpoken = beats.slice(0, Math.min(index + 1, beats.length)).filter((b) => b.kind !== 'round');
  const log = useRef<HTMLOListElement>(null);
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [lastSpoken.length]);

  // Bubbles sit over the speaker, but never run off the edge of the room.
  const at = me ? (me.x / W) * 100 : 50;
  const bubblePos: React.CSSProperties = at < 32 ? { left: '0.5rem' } : at > 68 ? { right: '0.5rem' } : { left: `${at}%`, transform: 'translateX(-50%)' };
  const streaming: LivePart | undefined = running && caughtUp ? Object.values(live.parts).find((p) => !p.done && p.text) : undefined;

  return (
    <div className="overflow-hidden rounded-2xl border-2 border-ink-900 bg-ink-900 shadow-[4px_4px_0_0_rgba(15,23,42,0.25)]">
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" shapeRendering="crispEdges" role="img" aria-label={tl('The council room: the advisors discussing your question')}>
          {/* Wall, window, sign */}
          <rect width={W} height={TABLE_Y} fill="#26324d" />
          {Array.from({ length: 12 }, (_, i) => (
            <rect key={i} x={i * 20} y={0} width={1} height={TABLE_Y - 8} fill="#2d3a58" />
          ))}
          <rect x={16} y={8} width={44} height={24} fill="#8ec5e8" />
          <rect x={16} y={8} width={44} height={24} fill="none" stroke="#5a4632" strokeWidth={2} />
          <rect x={37} y={8} width={2} height={24} fill="#5a4632" />
          <rect x={20} y={24} width={10} height={6} fill="#6fa86f" />
          <rect x={46} y={20} width={8} height={10} fill="#6fa86f" />
          <rect x={92} y={8} width={60} height={13} fill="#10131b" />
          <text x={122} y={17} textAnchor="middle" fontSize={6} fontFamily="ui-monospace, monospace" fontWeight={700} fill="#f2c230">
            {getLang() === 'ms' ? 'MAJLIS AI' : 'AI COUNCIL'}
          </text>
          <rect x={192} y={10} width={16} height={20} fill="#f4efe1" />
          <rect x={195} y={14} width={10} height={2} fill="#9aa3b2" />
          <rect x={195} y={18} width={8} height={2} fill="#9aa3b2" />
          <rect x={195} y={22} width={10} height={2} fill="#d64545" />
          {/* Floor */}
          <rect y={TABLE_Y - 8} width={W} height={H - TABLE_Y + 8} fill="#7a5a3c" />
          {Array.from({ length: 24 }, (_, i) => (
            <rect key={i} x={i * 10 + ((Math.floor(i / 2) % 2) * 5)} y={TABLE_Y - 8} width={1} height={H} fill="#6b4e33" />
          ))}
          {/* Chairs behind the advisors */}
          {seatKeys.map((k, i) => (
            <rect key={`chair-${k}`} x={seatX(i) + 1} y={SPRITE_Y + 6} width={18} height={20} fill="#3a2d22" />
          ))}
          {/* Advisors */}
          {seatKeys.map((k, i) => (
            <Sprite key={k} look={lookFor(k)} x={seatX(i)} y={SPRITE_Y} talking={speaker === k} />
          ))}
          {/* Table */}
          <rect x={4} y={TABLE_Y} width={196} height={12} fill="#a0703f" />
          <rect x={4} y={TABLE_Y + 12} width={196} height={3} fill="#6e4a28" />
          <rect x={10} y={TABLE_Y + 15} width={4} height={14} fill="#6e4a28" />
          <rect x={190} y={TABLE_Y + 15} width={4} height={14} fill="#6e4a28" />
          {/* Name plates */}
          {seatKeys.map((k, i) => (
            <g key={`plate-${k}`} className="hidden sm:inline">
              <rect x={seatX(i) + 1} y={TABLE_Y + 3} width={18} height={6} fill={speaker === k ? '#f2c230' : '#f4efe1'} />
              <text x={seatX(i) + 10} y={TABLE_Y + 7.4} textAnchor="middle" fontSize={3.4} fontFamily="ui-monospace, monospace" fill="#10131b">
                {plate(k)}
              </text>
            </g>
          ))}
          {/* Chairman at the lectern */}
          <Sprite look={lookFor('chairman')} x={chairX} y={SPRITE_Y - 6} talking={speaker === 'chairman'} />
          <rect x={chairX - 3} y={TABLE_Y - 2} width={26} height={30} fill="#5a3d22" />
          <rect x={chairX - 3} y={TABLE_Y - 2} width={26} height={3} fill="#c9a227" />
          <text x={chairX + 10} y={TABLE_Y + 11} textAnchor="middle" fontSize={3.6} fontFamily="ui-monospace, monospace" fill="#f2c230" className="hidden sm:inline">
            {getLang() === 'ms' ? 'PENGERUSI' : 'CHAIRMAN'}
          </text>

          {/* Badges above heads ("!" Contrarian, "?" Outsider, "§" Compliance) */}
          {seatKeys.map((k, i) => {
            const b = lookFor(k).badge;
            return b ? (
              <text key={`badge-${k}`} x={seatX(i) + 17} y={SPRITE_Y - 1} fontSize={6} fontWeight={700} fontFamily="ui-monospace, monospace" fill="#f2c230">
                {b}
              </text>
            ) : null;
          })}

          {/* Thinking dots */}
          {[...thinking].map((k) => {
            const p = posOf(k);
            if (!p) return null;
            return (
              <g key={`think-${k}`} className="typing">
                <rect x={p.x - 7} y={p.y - 10} width={14} height={7} fill="#ffffff" />
                <rect x={p.x - 1} y={p.y - 3} width={2} height={2} fill="#ffffff" />
                {[0, 1, 2].map((d) => (
                  <rect key={d} x={p.x - 5 + d * 4} y={p.y - 7.5} width={2} height={2} fill="#26324d" style={{ animation: 'pulse-dot 1.2s infinite', animationDelay: `${d * 0.15}s` }} />
                ))}
              </g>
            );
          })}

          {/* Everyone nods at an agreement */}
          {agreeing &&
            seatKeys.map((k, i) => (
              <text key={`ok-${k}`} x={seatX(i) + 10} y={SPRITE_Y - 2} textAnchor="middle" fontSize={7} fontWeight={700} fill="#4ade80">
                ✓
              </text>
            ))}

          {/* Peer review: a pointer from reviewer to reviewed, with the score */}
          {beat?.kind === 'review' && me && them && (
            <g>
              <line x1={me.x} y1={me.y + 4} x2={them.x} y2={them.y + 4} stroke="#f2c230" strokeWidth={1} strokeDasharray="2 2" />
              <rect x={them.x - 6} y={them.y - 11} width={12} height={8} fill={beat.score && beat.score >= 4 ? '#16a34a' : beat.score && beat.score <= 2 ? '#dc2626' : '#d97706'} />
              <text x={them.x} y={them.y - 5} textAnchor="middle" fontSize={5.5} fontWeight={700} fill="#ffffff" fontFamily="ui-monospace, monospace">
                {beat.score}/5
              </text>
            </g>
          )}

          {/* A clash: lightning between the two sides */}
          {beat?.kind === 'clash' && me && them && (
            <polyline
              className="room-flash"
              points={`${me.x},${me.y - 2} ${(me.x + them.x) / 2 - 3},${me.y - 10} ${(me.x + them.x) / 2 + 3},${me.y - 4} ${them.x},${them.y - 2}`}
              fill="none"
              stroke="#fde047"
              strokeWidth={1.5}
            />
          )}
        </svg>

        {/* Round banner */}
        {roundBanner && (
          <div className="pointer-events-none absolute top-2 left-2 bg-ink-900/85 px-2 py-0.5 font-mono text-[10px] font-bold tracking-wide text-amber-300 uppercase sm:text-xs">
            {roundBanner}
          </div>
        )}

        {/* Speech bubble */}
        {beat && beat.kind !== 'round' && (
          <div
            key={beat.id}
            className={cx(
              'room-pop pointer-events-none absolute top-2 max-w-[80%] border-2 border-ink-900 px-2.5 py-1.5 text-[11px] leading-snug shadow-[3px_3px_0_0_rgba(15,23,42,0.6)] sm:max-w-[62%] sm:text-sm',
              beat.kind === 'verdict' || beat.kind === 'first' ? 'bg-amber-100' : beat.kind === 'clash' ? 'bg-red-50' : beat.kind === 'agree' ? 'bg-emerald-50' : beat.kind === 'insight' || beat.kind === 'missed' ? 'bg-violet-50' : 'bg-white',
            )}
            style={{ ...bubblePos, marginTop: roundBanner ? '1.6rem' : undefined }}
          >
            {beat.speaker && (
              <p className="font-mono text-[10px] font-bold text-ink-500 uppercase">
                {nameOf(beat.speaker)}
                {beat.kind === 'verdict' && ` · ${tl('Verdict')}`}
              </p>
            )}
            <p className="text-ink-900">{beat.text}</p>
          </div>
        )}
        {!beat && streaming && (
          <div className="pointer-events-none absolute top-2 left-1/2 max-w-[78%] -translate-x-1/2 border-2 border-dashed border-ink-400 bg-white/90 px-2.5 py-1.5 text-[11px] text-ink-600 sm:max-w-[62%] sm:text-sm">
            <p className="font-mono text-[10px] font-bold text-ink-400 uppercase">{nameOf(streaming.persona)} · {tl('thinking out loud')}</p>
            <p>{clip(streaming.text.slice(-200), 200)}</p>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 border-t-2 border-ink-900 bg-ink-800 px-3 py-2 text-xs text-ink-100">
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded bg-ink-700 px-2 py-1 font-mono hover:bg-ink-600"
          onClick={() => {
            if (caughtUp && !running) {
              setIndex(0);
              setPlaying(true);
            } else setPlaying((p) => !p);
          }}
        >
          {playing && !(caughtUp && !running) ? tl('Pause') : tl('Play')}
        </button>
        <button type="button" className="inline-flex items-center gap-1 rounded bg-ink-700 px-2 py-1 font-mono hover:bg-ink-600" onClick={() => { setIndex(0); setPlaying(true); }}>
          <Icon name="retry" className="h-3 w-3" /> {tl('Replay')}
        </button>
        <button type="button" className="rounded bg-ink-700 px-2 py-1 font-mono hover:bg-ink-600" onClick={() => setSpeed((s) => (s >= 4 ? 1 : s * 2))} title={tl('Speed')}>
          {speed}×
        </button>
        <button type="button" className="rounded bg-ink-700 px-2 py-1 font-mono hover:bg-ink-600" onClick={() => setIndex(beats.length)}>
          {tl('Skip to latest')}
        </button>
        <span className="ml-auto font-mono text-ink-300">
          {Math.min(index + 1, beats.length)}/{beats.length}
          {running ? ` · ${tl('live')}` : ''}
        </span>
      </div>

      {/* Transcript: what has been said so far; click a line to jump back to it. */}
      {lastSpoken.length > 0 && (
        <ol ref={log} className="max-h-40 space-y-1 overflow-y-auto bg-ink-50 px-3 py-2 text-xs" aria-live="polite">
          {lastSpoken.map((b) => (
            <li key={b.id}>
              <button type="button" className="w-full text-left hover:underline" onClick={() => { setIndex(beats.indexOf(b)); setPlaying(false); }}>
                <span className="mr-1 inline-block h-2 w-2" style={{ background: b.speaker ? lookFor(b.speaker).shirt : '#999' }} />
                <span className="font-semibold text-ink-800">{b.speaker ? nameOf(b.speaker) : ''}</span>
                {b.target && b.kind === 'review' ? <span className="text-ink-500"> → {nameOf(b.target)}</span> : null}
                {b.score ? <span className="text-ink-500"> ({b.score}/5)</span> : null}: <span className="text-ink-700">{b.text}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
