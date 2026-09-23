import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { Person } from '../types';
import { cx } from './ui';

/** Choose a task owner from the staff directory only (candidates first, then search). */
export function OwnerPicker({
  value,
  candidates,
  onChange,
  disabled,
}: {
  value: Person | null;
  candidates: Person[];
  onChange(p: Person): void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Person[]>([]);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      api<Person[]>(`/api/directory/search?q=${encodeURIComponent(q)}`).then(setResults).catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(t);
  }, [q, open]);

  useEffect(() => {
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const list = q ? results : [...candidates, ...results.filter((r) => !candidates.some((c) => c.id === r.id))];

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cx(
          'w-full rounded-lg border px-2.5 py-1.5 text-left text-sm disabled:opacity-60',
          value ? 'border-ink-200 bg-white' : 'border-amber-300 bg-amber-50',
        )}
      >
        {value ? (
          <>
            <span className="block truncate font-medium text-ink-900">{value.name}</span>
            <span className="block truncate text-xs text-ink-400">
              {value.position} · {value.email}
            </span>
          </>
        ) : (
          <span className="text-amber-800">{candidates.length ? `Choose owner (${candidates.length} match)` : 'Unassigned: choose owner'}</span>
        )}
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-72 rounded-lg border border-ink-200 bg-white p-1 shadow-lg">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, position or department"
            className="mb-1 w-full rounded-md border border-ink-200 px-2 py-1 text-sm focus:border-accent-600 focus:outline-none"
          />
          <ul className="max-h-60 overflow-y-auto">
            {list.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(p);
                    setOpen(false);
                  }}
                  className="w-full rounded-md px-2 py-1.5 text-left hover:bg-ink-50"
                >
                  <span className="block text-sm font-medium">
                    {p.name} {candidates.some((c) => c.id === p.id) && <span className="text-xs text-accent-700">· suggested</span>}
                  </span>
                  <span className="block text-xs text-ink-400">
                    {p.position}
                    {p.department ? ` · ${p.department}` : ''}
                  </span>
                </button>
              </li>
            ))}
            {!list.length && <li className="px-2 py-2 text-xs text-ink-400">No one found. Ask an admin to add them to the staff directory.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
