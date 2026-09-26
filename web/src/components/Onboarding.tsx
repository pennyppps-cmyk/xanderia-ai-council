import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { tl } from '../i18n';
import { Button, cx } from './ui';

interface Checklist {
  lead: boolean;
  items: Array<{ key: string; title: string; hint: string; link: string; done: boolean }>;
  done: number;
  total: number;
  complete: boolean;
  dismissed: boolean;
}

/** "Getting started" card on the home screen. Items tick themselves off from what the person actually did. */
export function OnboardingCard() {
  const [c, setC] = useState<Checklist | null>(null);
  useEffect(() => {
    api<Checklist>('/api/onboarding').then(setC).catch(() => {});
  }, []);
  if (!c || c.complete || c.dismissed || !c.total) return null;
  return (
    <section className="mt-6 rounded-xl border border-accent-200 bg-accent-50/60 p-4 text-left">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink-900">
            {c.lead ? tl('Set up the council for your department') : tl('Getting started')}
          </h2>
          <p className="text-xs text-ink-600">
            {c.lead
              ? tl('As department lead, these steps make the council accurate for your team. They tick themselves off as you do them.')
              : tl('Three quick things to try. They tick themselves off as you do them.')}
          </p>
        </div>
        <span className="shrink-0 text-xs font-medium text-accent-800">{tl('{done} of {total} done', { done: c.done, total: c.total })}</span>
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-white">
        <div className="h-1.5 rounded-full bg-accent-600" style={{ width: `${(c.done / c.total) * 100}%` }} />
      </div>
      <ol className="mt-3 space-y-2">
        {c.items.map((i) => (
          <li key={i.key} className="flex items-start gap-2 text-sm">
            <span
              aria-hidden
              className={cx(
                'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px]',
                i.done ? 'border-accent-600 bg-accent-600 text-white' : 'border-ink-300 bg-white',
              )}
            >
              {i.done ? '✓' : ''}
            </span>
            <span className="min-w-0">
              {i.done ? (
                <span className="text-ink-400 line-through">{tl(i.title)}</span>
              ) : (
                <Link to={i.link} className="font-medium text-ink-900 hover:underline">
                  {tl(i.title)}
                </Link>
              )}
              {!i.done && <span className="block text-xs text-ink-500">{tl(i.hint)}</span>}
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-3 text-right">
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            await api('/api/onboarding/dismiss', { method: 'POST' }).catch(() => {});
            setC({ ...c, dismissed: true });
          }}
        >
          {tl('Hide for now')}
        </Button>
      </div>
    </section>
  );
}
