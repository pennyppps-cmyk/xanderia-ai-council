import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { CrewPanel } from '../components/CrewPanel';
import { Badge, Button, Spinner } from '../components/ui';
import type { CrewTask, PlanSummary } from '../types';
import { Shell } from './Plan';
import { statusLabel, tl } from '../i18n';

const STATUS_TONE: Record<string, 'neutral' | 'green' | 'amber' | 'red' | 'blue'> = {
  sent: 'amber',
  accepted: 'blue',
  in_progress: 'blue',
  blocked: 'red',
  cant_do: 'red',
  done: 'green',
};

/** My tasks (assigned to me via the staff directory) and the action plans I requested. */
export default function TasksPage() {
  const [mine, setMine] = useState<CrewTask[] | null>(null);
  const [plans, setPlans] = useState<PlanSummary[] | null>(null);
  const [tick, setTick] = useState(0);

  const load = useCallback(() => {
    api<CrewTask[]>('/api/tasks/mine').then(setMine).catch(() => setMine([]));
    api<PlanSummary[]>('/api/plans').then(setPlans).catch(() => setPlans([]));
  }, []);
  useEffect(load, [load, tick]);

  const act = async (t: CrewTask, action: string) => {
    let note: string | undefined;
    if (action === 'help' || action === 'cant') {
      note = prompt(action === 'help' ? tl('What do you need?') : tl("Why can't you do it?")) ?? undefined;
      if (!note) return;
    }
    await api(`/api/tasks/${t.id}/action`, { body: { action, note } }).catch((e) => alert(e.message));
    setTick((n) => n + 1);
  };

  return (
    <Shell title={tl("Tasks")}>
      <div className="space-y-6">
        <CrewPanel refreshKey={tick} />

        <section>
          <h2 className="mb-2 text-sm font-semibold">{tl("Assigned to me")}</h2>
          {!mine ? (
            <Spinner className="h-5 w-5 text-ink-400" />
          ) : mine.length === 0 ? (
            <p className="rounded-xl border border-ink-100 bg-white p-4 text-sm text-ink-400">{tl("No tasks assigned to you.")}</p>
          ) : (
            <ul className="divide-y divide-ink-100 rounded-xl border border-ink-100 bg-white">
              {mine.map((t) => (
                <li key={t.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{t.title}</p>
                    <p className="text-xs text-ink-600">{t.description}</p>
                    <p className="mt-0.5 text-[11px] text-ink-400">
                      {tl("From")} {t.requester_name} · {t.plan_title}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <Badge tone={STATUS_TONE[t.status] ?? 'neutral'}>{statusLabel(t.status)}</Badge>
                    {t.due_date && <Badge>{tl("due")} {t.due_date}</Badge>}
                    {t.status === 'sent' && (
                      <Button size="sm" variant="primary" onClick={() => act(t, 'accept')}>
                        {tl("Accept")}
                      </Button>
                    )}
                    {['sent', 'accepted'].includes(t.status) && (
                      <Button size="sm" onClick={() => act(t, 'start')}>
                        {tl("Start")}
                      </Button>
                    )}
                    {['sent', 'accepted', 'in_progress', 'blocked'].includes(t.status) && (
                      <>
                        <Button size="sm" onClick={() => act(t, 'done')}>
                          {tl("Mark done")}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => act(t, 'help')}>
                          {tl("Need help")}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => act(t, 'cant')}>
                          {tl("Can't do")}
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold">{tl("Action plans I started")}</h2>
          {!plans ? (
            <Spinner className="h-5 w-5 text-ink-400" />
          ) : plans.length === 0 ? (
            <p className="rounded-xl border border-ink-100 bg-white p-4 text-sm text-ink-400">
              {tl("None yet. Open a council verdict and press")} <strong>{tl("Put into action")}</strong>.
            </p>
          ) : (
            <ul className="grid gap-2 md:grid-cols-2">
              {plans.map((p) => {
                const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
                return (
                  <li key={p.id}>
                    <Link to={`/plans/${p.id}`} className="block rounded-xl border border-ink-100 bg-white p-3 hover:border-accent-500">
                      <p className="line-clamp-2 text-sm font-medium">{p.title}</p>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-100">
                        <div className="h-full bg-accent-500" style={{ width: `${pct}%` }} />
                      </div>
                      <p className="mt-1 text-[11px] text-ink-400">
                        {statusLabel(p.status)} · {p.done}/{p.total} {tl("done")}
                        {p.overdue ? ` · ${tl('{n} overdue', { n: p.overdue })}` : ''}
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </Shell>
  );
}
