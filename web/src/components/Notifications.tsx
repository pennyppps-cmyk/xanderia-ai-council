import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import type { AppNotification } from '../types';
import { cx } from './ui';
import { tl } from '../i18n';

function ago(iso: string) {
  const s = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return tl('{n}s ago', { n: s });
  if (s < 3600) return tl('{n}m ago', { n: Math.round(s / 60) });
  if (s < 86400) return tl('{n}h ago', { n: Math.round(s / 3600) });
  return tl('{n}d ago', { n: Math.round(s / 86400) });
}

/** Bell with the Crew's nudges and updates. `pulse` changes whenever a live notification arrives. */
export function NotificationBell({ pulse, dark = true }: { pulse?: unknown; dark?: boolean }) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    api<AppNotification[]>('/api/notifications').then(setItems).catch(() => {});
  }, []);
  useEffect(load, [load, pulse]);

  useEffect(() => {
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const unread = items.filter((n) => !n.read_at).length;

  return (
    <div ref={box} className="relative">
      <button
        onClick={() => {
          setOpen((o) => !o);
          if (!open && unread) api('/api/notifications/read', { body: {} }).then(load).catch(() => {});
        }}
        className={cx('relative rounded-md p-1.5', dark ? 'text-ink-200 hover:bg-ink-900 hover:text-white' : 'text-ink-600 hover:bg-ink-100')}
        aria-label={`${tl('Notifications')}${unread ? ` (${tl('{n} unread', { n: unread })})` : ''}`}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4.5 w-4.5" aria-hidden>
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-80 rounded-xl border border-ink-200 bg-white text-ink-900 shadow-xl">
          <p className="border-b border-ink-100 px-3 py-2 text-xs font-semibold">{tl("Notifications")}</p>
          <ul className="max-h-96 overflow-y-auto">
            {items.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => {
                    setOpen(false);
                    if (n.link) navigate(n.link);
                  }}
                  className={cx('block w-full px-3 py-2 text-left hover:bg-ink-50', !n.read_at && 'bg-accent-50/60')}
                >
                  <span className="block text-sm font-medium">{n.title}</span>
                  {n.body && <span className="block text-xs text-ink-600">{n.body}</span>}
                  <span className="block text-[11px] text-ink-400">{ago(n.created_at)}</span>
                </button>
              </li>
            ))}
            {!items.length && <li className="px-3 py-4 text-center text-xs text-ink-400">{tl("Nothing yet.")}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

