import { useEffect, useState } from 'react';
import { api } from '../api';
import type { CrewAgent } from '../types';
import { cx } from './ui';

const INITIALS: Record<string, string> = { dispatcher: 'D', herald: 'H', tracker: 'T', runner: 'R' };
const TONE: Record<string, string> = {
  dispatcher: 'bg-sky-100 text-sky-800',
  herald: 'bg-violet-100 text-violet-800',
  tracker: 'bg-amber-100 text-amber-800',
  runner: 'bg-emerald-100 text-emerald-800',
};

/** The four Action Crew agents with live status lines ("3 online" roster). */
export function CrewPanel({ refreshKey, compact = false }: { refreshKey?: unknown; compact?: boolean }) {
  const [agents, setAgents] = useState<CrewAgent[] | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => api<CrewAgent[]>('/api/crew/status').then((a) => alive && setAgents(a)).catch(() => {});
    load();
    const t = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [refreshKey]);

  if (!agents) return null;
  return (
    <div className={cx('rounded-xl border border-ink-100 bg-white', compact ? 'p-2' : 'p-3')}>
      <div className="mb-2 flex items-center justify-between px-1">
        <p className="text-xs font-semibold text-ink-800">Action Crew</p>
        <p className="flex items-center gap-1.5 text-[11px] text-ink-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> {agents.length} online
        </p>
      </div>
      <ul className={cx('grid gap-1.5', compact ? 'grid-cols-1' : 'sm:grid-cols-2 lg:grid-cols-4')}>
        {agents.map((a) => (
          <li key={a.key} className="flex items-center gap-2 rounded-lg bg-ink-50 px-2 py-1.5">
            <span className={cx('relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold', TONE[a.key])}>
              {INITIALS[a.key]}
              <span className={cx('absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2 border-white', a.busy ? 'animate-pulse bg-amber-500' : 'bg-emerald-500')} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-xs font-semibold text-ink-900">{a.name}</span>
              <span className="block truncate text-[11px] text-ink-600">{a.status}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
