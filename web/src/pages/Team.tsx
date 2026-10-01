import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { OwnerPicker } from '../components/OwnerPicker';
import { Badge, Button, cx, Field, inputCls, Spinner } from '../components/ui';
import { tl } from '../i18n';
import type { Person } from '../types';
import { Shell } from './Plan';

interface TeamTask {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
  response_note: string | null;
  plan_id: string;
  plan_title: string;
}
interface Member {
  id: string;
  name: string;
  position: string;
  open: number;
  overdue: number;
  due_this_week: number;
  away_until: string | null;
  backup_id: string | null;
  overloaded: boolean;
  tasks: TeamTask[];
}

const today = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

/** Team board for department leads: who is carrying what, who is away, and handing work over. */
export default function TeamPage() {
  const { me, departments } = useAuth();
  const [dept, setDept] = useState<string>('');
  const [data, setData] = useState<{ department_id: string; limits: { open: number; overdue: number }; people: Member[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api<typeof data>(`/api/team${dept ? `?department=${dept}` : ''}`)
      .then((d) => {
        setData(d);
        if (!dept && d) setDept(d.department_id);
      })
      .catch((e) => setError((e as Error).message));
  }, [dept]);
  useEffect(load, [load]);

  if (me?.user.role === 'employee') return <Shell title={tl('Team')}><p className="text-sm text-ink-600">{tl('The team board is for department leads.')}</p></Shell>;

  return (
    <Shell
      title={tl('Team')}
      right={
        me?.user.role === 'admin' ? (
          <select className="rounded-lg border border-ink-200 px-2 py-1 text-sm" value={dept} onChange={(e) => setDept(e.target.value)}>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        ) : undefined
      }
    >
      {error && <p className="text-sm text-red-700">{error}</p>}
      {!data ? (
        <Spinner />
      ) : (
        <>
          <p className="mb-4 max-w-3xl text-sm text-ink-600">
            {tl('Open tasks per person. Someone with {open}+ open or {overdue}+ overdue tasks is marked overloaded, and plans suggest a colleague instead. Set leave and a backup so new tasks go to the backup while someone is away.', data.limits)}
          </p>
          {data.people.length === 0 && <p className="text-sm text-ink-500">{tl('Nobody from this department is in the staff directory yet.')}</p>}
          <div className="grid gap-3 lg:grid-cols-2">
            {[...data.people]
              .sort((a, b) => b.overdue - a.overdue || b.open - a.open)
              .map((p) => (
                <MemberCard key={p.id} p={p} team={data.people} onChanged={load} />
              ))}
          </div>
        </>
      )}
    </Shell>
  );
}

function MemberCard({ p, team, onChanged }: { p: Member; team: Member[]; onChanged(): void }) {
  const [panel, setPanel] = useState<null | 'leave' | 'handover'>(null);
  const [away, setAway] = useState(p.away_until ?? '');
  const [backup, setBackup] = useState<Person | null>(() => {
    const b = team.find((x) => x.id === p.backup_id);
    return b ? { id: b.id, name: b.name, position: b.position, email: '' } : null;
  });
  const [to, setTo] = useState<Person | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isAway = Boolean(p.away_until && p.away_until >= today());
  const colleagues = team.filter((x) => x.id !== p.id).map((x) => ({ id: x.id, name: x.name, position: `${x.position} · ${x.open} open`, email: '' }));

  return (
    <section className={cx('rounded-xl border bg-white p-4 shadow-sm', p.overloaded ? 'border-amber-300' : 'border-ink-100')}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink-900">{p.name}</p>
          <p className="text-xs text-ink-500">{p.position}</p>
        </div>
        {isAway && <Badge tone="blue">{tl('Away until {d}', { d: p.away_until! })}</Badge>}
        {p.overloaded && <Badge tone="amber">{tl('Overloaded')}</Badge>}
      </div>
      <div className="mt-2 flex gap-4 text-sm">
        <span>
          <strong>{p.open}</strong> {tl('open')}
        </span>
        <span className={p.overdue ? 'text-red-700' : ''}>
          <strong>{p.overdue}</strong> {tl('overdue')}
        </span>
        <span>
          <strong>{p.due_this_week}</strong> {tl('due this week')}
        </span>
      </div>
      {p.tasks.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs">
          {p.tasks.slice(0, 6).map((t) => (
            <li key={t.id} className="flex gap-2">
              <span className={cx('shrink-0', t.due_date && t.due_date < today() ? 'text-red-700' : 'text-ink-400')}>{t.due_date ?? '-'}</span>
              <Link to={`/plans/${t.plan_id}`} className="min-w-0 flex-1 truncate text-ink-700 hover:underline" title={t.plan_title}>
                {t.title}
              </Link>
              {t.status === 'blocked' && <Badge tone="red">{tl('needs help')}</Badge>}
            </li>
          ))}
          {p.tasks.length > 6 && <li className="text-ink-400">{tl('and {n} more', { n: p.tasks.length - 6 })}</li>}
        </ul>
      )}
      <div className="mt-3 flex gap-1">
        <Button size="sm" variant="ghost" onClick={() => setPanel(panel === 'leave' ? null : 'leave')}>
          {tl('Leave & backup')}
        </Button>
        {p.open > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setPanel(panel === 'handover' ? null : 'handover')}>
            {tl('Hand over all tasks')}
          </Button>
        )}
      </div>
      {panel === 'leave' && (
        <div className="mt-2 grid gap-2 rounded-lg bg-ink-50 p-2 sm:grid-cols-2">
          <Field label={tl('Away until (inclusive)')}>
            <input type="date" className={cx(inputCls, 'py-1')} value={away} onChange={(e) => setAway(e.target.value)} />
          </Field>
          <Field label={tl('Backup while away')}>
            <OwnerPicker value={backup} candidates={colleagues} onChange={setBackup} />
          </Field>
          <div className="flex gap-2 sm:col-span-2">
            <Button
              size="sm"
              variant="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await api(`/api/team/${p.id}/availability`, { method: 'PATCH', body: { away_until: away || null, backup_id: backup?.id ?? null } }).catch((e) => setMsg((e as Error).message));
                setBusy(false);
                setPanel(null);
                onChanged();
              }}
            >
              {tl('Save')}
            </Button>
            {p.away_until && (
              <Button size="sm" onClick={() => setAway('')}>
                {tl('Back at work')}
              </Button>
            )}
          </div>
          <p className="text-xs text-ink-500 sm:col-span-2">{tl('New tasks due while they are away go to the backup. Tasks they already have stay with them; use "Hand over all tasks" to move those.')}</p>
        </div>
      )}
      {panel === 'handover' && (
        <div className="mt-2 space-y-2 rounded-lg bg-ink-50 p-2">
          <Field label={tl('Give all {n} open task(s) to', { n: p.open })}>
            <OwnerPicker value={to} candidates={colleagues} onChange={setTo} />
          </Field>
          <Button
            size="sm"
            variant="primary"
            disabled={!to || busy}
            onClick={async () => {
              if (!to || !confirm(tl('Move every open task from {a} to {b}? {b} gets them by email as new tasks.', { a: p.name, b: to.name }))) return;
              setBusy(true);
              try {
                const r = await api<{ moved: number }>(`/api/team/${p.id}/hand-over`, { body: { to: to.id } });
                setMsg(tl('{n} task(s) handed over.', { n: r.moved }));
                onChanged();
              } catch (e) {
                setMsg((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {tl('Hand over')}
          </Button>
        </div>
      )}
      {msg && <p className="mt-2 text-xs text-ink-600">{msg}</p>}
    </section>
  );
}
