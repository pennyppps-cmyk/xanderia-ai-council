import { useEffect, useReducer, useRef } from 'react';
import type { Citation, Message, RouterInfo, Status, Verdict } from './types';

export interface LivePart {
  part: string;
  stage: number;
  persona: string;
  label?: string;
  text: string;
  done: boolean;
  error?: string;
  data?: any;
}

export interface LiveState {
  status: Status;
  stage: string | null;
  position: number | null;
  mode: 'quick' | 'council' | null;
  router: RouterInfo | null;
  parts: Record<string, LivePart>;
  verdict: Verdict | null;
  raw: string | null;
  citations: Citation[];
  error: string | null;
}

type Action = { type: string; [k: string]: any };

function partKeyFor(p: { stage: number; persona_key: string }) {
  return `s${p.stage}:${p.persona_key}`;
}

export function initialLive(m: Message): LiveState {
  const parts: Record<string, LivePart> = {};
  for (const p of m.parts ?? []) {
    parts[partKeyFor(p)] = {
      part: partKeyFor(p),
      stage: p.stage,
      persona: p.persona_key,
      label: p.anon_label ?? undefined,
      text: p.content,
      done: true,
      error: p.data?.error ?? undefined,
      data: p.data,
    };
  }
  return {
    status: m.status,
    stage: m.stage,
    position: null,
    mode: m.mode,
    router: m.router,
    parts,
    verdict: m.verdict,
    raw: m.mode === 'council' && !m.verdict && m.status === 'done' ? m.content : null,
    citations: m.citations ?? [],
    error: m.error,
  };
}

function reducer(state: LiveState, e: Action): LiveState {
  switch (e.type) {
    case 'snapshot': {
      const base = initialLive(e.message);
      for (const [part, text] of Object.entries(e.partials as Record<string, string>)) {
        const existing = base.parts[part];
        if (existing?.done) continue;
        base.parts[part] = { ...(existing ?? { part, stage: 0, persona: '', done: false }), text };
      }
      if (e.message.mode === 'quick' && e.message.status === 'done') {
        base.parts.answer = { part: 'answer', stage: 0, persona: 'dept_expert', text: e.message.content, done: true };
      }
      return { ...base, position: e.position ?? null };
    }
    case 'status':
      return {
        ...state,
        status: e.status,
        stage: e.stage ?? state.stage,
        position: e.status === 'queued' ? (e.position ?? state.position) : null,
      };
    case 'router':
      return { ...state, router: e.router, mode: e.mode };
    case 'citations':
      return { ...state, citations: e.citations };
    case 'part_start': {
      const existing = state.parts[e.part];
      return {
        ...state,
        parts: {
          ...state.parts,
          [e.part]: { part: e.part, stage: e.stage, persona: e.persona, label: e.label, text: existing?.text ?? '', done: false },
        },
      };
    }
    case 'token': {
      const p = state.parts[e.part] ?? { part: e.part, stage: 0, persona: '', text: '', done: false };
      if (p.done) return state;
      const len = p.text.length;
      let text = p.text;
      // Offsets let us drop overlap between the snapshot's partial text and live tokens.
      if (e.offset === len) text += e.text;
      else if (e.offset < len && e.offset + e.text.length > len) text += e.text.slice(len - e.offset);
      else return state;
      return {
        ...state,
        status: state.status === 'queued' ? 'running' : state.status,
        position: null,
        parts: { ...state.parts, [e.part]: { ...p, text } },
      };
    }
    case 'part_done': {
      const p = state.parts[e.part] ?? { part: e.part, stage: 0, persona: '', text: '', done: false };
      return {
        ...state,
        parts: { ...state.parts, [e.part]: { ...p, text: e.content ?? p.text, done: true, error: e.error, data: e.data } },
      };
    }
    case 'verdict':
      return { ...state, verdict: e.verdict ?? null, raw: e.raw ?? null };
    case 'error':
      return { ...state, status: 'error', error: e.message };
    case 'done':
      return { ...state, status: 'done', stage: null };
    default:
      return state;
  }
}

const EVENTS = ['snapshot', 'status', 'router', 'citations', 'part_start', 'token', 'part_done', 'verdict', 'done', 'error'];

/** Live state for one assistant message; opens an SSE stream only while it is unfinished. */
export function useMessageStream(message: Message, onFinished?: () => void) {
  const [state, dispatch] = useReducer(reducer, message, initialLive);
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;
  const active = message.status === 'queued' || message.status === 'running';

  useEffect(() => {
    if (!active) return;
    const es = new EventSource(`/api/messages/${message.id}/stream`);
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      es.close();
      finishedRef.current?.();
    };
    for (const name of EVENTS) {
      es.addEventListener(name, (ev) => {
        const data = JSON.parse((ev as MessageEvent).data);
        dispatch({ ...data, type: name });
        if (name === 'done' || name === 'error') finish();
        if (name === 'snapshot' && (data.message.status === 'done' || data.message.status === 'error')) finish();
      });
    }
    return () => es.close();
  }, [message.id, active]);

  return state;
}
