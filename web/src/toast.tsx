import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from './components/ui';

interface Toast {
  id: number;
  title: string;
  body?: string;
  href?: string;
}

let listeners: Array<(t: Toast) => void> = [];
let seq = 0;

export function toast(t: Omit<Toast, 'id'>) {
  const full = { ...t, id: ++seq };
  for (const l of listeners) l(full);
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const add = (t: Toast) => {
      setItems((all) => [...all, t]);
      setTimeout(() => setItems((all) => all.filter((x) => x.id !== t.id)), 8000);
    };
    listeners.push(add);
    return () => {
      listeners = listeners.filter((l) => l !== add);
    };
  }, []);
  return (
    <div className="pointer-events-none fixed right-4 bottom-24 z-50 flex w-80 flex-col gap-2">
      {items.map((t) => (
        <div key={t.id} className="pointer-events-auto flex items-start gap-3 rounded-xl bg-ink-900 p-3 text-sm text-white shadow-lg">
          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-accent-500" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{t.title}</p>
            {t.body && <p className="truncate text-ink-200">{t.body}</p>}
            {t.href && (
              <Link
                to={t.href}
                onClick={() => setItems((all) => all.filter((x) => x.id !== t.id))}
                className="mt-1 inline-block text-xs font-medium text-accent-100 underline"
              >
                Open
              </Link>
            )}
          </div>
          <button onClick={() => setItems((all) => all.filter((x) => x.id !== t.id))} aria-label="Dismiss" className="text-ink-400 hover:text-white">
            <Icon name="close" className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
