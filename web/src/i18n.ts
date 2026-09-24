import { useEffect, useState } from 'react';
import { ms } from './i18n.ms';

/**
 * UI language (English / Bahasa Malaysia). Keys are the English strings themselves,
 * so anything not yet translated simply shows in English. `{name}` placeholders are
 * filled from `vars`.
 */
export type Lang = 'en' | 'ms';

function initial(): Lang {
  try {
    const saved = localStorage.getItem('xc:lang');
    if (saved === 'en' || saved === 'ms') return saved;
  } catch {}
  return 'en';
}

let current: Lang = initial();
const listeners = new Set<(l: Lang) => void>();
document.documentElement.lang = current;

export function tl(text: string, vars?: Record<string, string | number>): string {
  let out = current === 'ms' ? (ms[text] ?? text) : text;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return out;
}

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang) {
  if (lang === current) return;
  current = lang;
  try {
    localStorage.setItem('xc:lang', lang);
  } catch {}
  document.documentElement.lang = lang;
  for (const fn of listeners) fn(lang);
}

/** Re-render on language change (the app root keys its tree on this). */
export function useLang(): Lang {
  const [lang, set] = useState(current);
  useEffect(() => {
    listeners.add(set);
    return () => void listeners.delete(set);
  }, []);
  return lang;
}

/** Locale for dates and numbers. */
export const dateLocale = () => (current === 'ms' ? 'ms-MY' : 'en-MY');

const STATUS: Record<string, string> = {
  planning: 'planning',
  ready: 'awaiting your approval',
  launched: 'launched',
  done: 'done',
  cancelled: 'cancelled',
  error: 'error',
  draft: 'draft',
  sent: 'sent',
  accepted: 'accepted',
  in_progress: 'in progress',
  running: 'running',
  review: 'review',
  blocked: 'blocked',
  cant_do: "can't do",
};

/** Plan / task status as a translated label. */
export const statusLabel = (s: string) => tl(STATUS[s] ?? s.replace(/_/g, ' '));
