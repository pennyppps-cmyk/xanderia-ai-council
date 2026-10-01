import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Badge, Button, cx, Field, Icon, inputCls, Spinner } from '../components/ui';
import { tl } from '../i18n';
import { Shell } from './Plan';

type Source = 'manual' | 'npl_ratio' | 'par30';
interface Goal {
  id: string;
  title: string;
  description: string;
  quarter: string;
  department_id: string | null;
  department: string | null;
  owner: string | null;
  owner_id: string | null;
  metric_source: Source;
  metric: string;
  unit: string;
  baseline: number | null;
  target: number | null;
  current: number | null;
  current_from: string | null;
  status: 'active' | 'achieved' | 'missed' | 'dropped';
  conversation_id: string | null;
  council_status: string | null;
  plan_id: string | null;
  tasks_total: number;
  tasks_done: number;
  metric_progress: number | null;
  task_progress: number | null;
}

const quarterOf = (d = new Date(Date.now() + 8 * 3600_000)) => `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
const shiftQuarter = (q: string, by: number) => {
  const [y, n] = q.split('-Q').map(Number);
  const i = y * 4 + (n - 1) + by;
  return `${Math.floor(i / 4)}-Q${(i % 4) + 1}`;
};
const STATUS_TONE = { active: 'blue', achieved: 'green', missed: 'red', dropped: 'neutral' } as const;
const SOURCE_LABEL: Record<Source, string> = { manual: 'Entered by hand', npl_ratio: 'NPL ratio from the portfolio report (%)', par30: 'PAR30 from the portfolio report (%)' };

/** Quarterly goals → council plans → milestones, with progress. */
export default function GoalsPage() {
  const { me, departments } = useAuth();
  const [quarter, setQuarter] = useState(quarterOf());
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [editing, setEditing] = useState<Partial<Goal> | null>(null);
  const load = useCallback(() => {
    api<{ goals: Goal[] }>(`/api/goals?quarter=${quarter}`).then((d) => setGoals(d.goals)).catch(() => setGoals([]));
  }, [quarter]);
  useEffect(load, [load]);
  const lead = me?.user.role !== 'employee';

  return (
    <Shell
      title={tl('Goals')}
      right={
        <span className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => setQuarter(shiftQuarter(quarter, -1))} aria-label={tl('Previous quarter')}>
            ‹
          </Button>
          <span className="w-20 text-center text-sm font-medium">{quarter.replace('-', ' ')}</span>
          <Button size="sm" variant="ghost" onClick={() => setQuarter(shiftQuarter(quarter, 1))} aria-label={tl('Next quarter')}>
            ›
          </Button>
        </span>
      }
    >
      <div className="mx-auto max-w-5xl space-y-4">
        <p className="max-w-3xl text-sm text-ink-600">
          {tl('Set the quarter\'s targets, let the council plan how to reach each one, then put the plan into action. Progress shows the tasks done and how far the figure has moved towards the target.')}
        </p>
        {lead && !editing && (
          <Button variant="primary" size="sm" onClick={() => setEditing({ quarter, metric_source: 'manual', status: 'active', department_id: me?.user.role === 'admin' ? null : me?.user.department_id ?? null })}>
            <Icon name="plus" className="h-3.5 w-3.5" /> {tl('New goal')}
          </Button>
        )}
        {editing && <GoalForm goal={editing} admin={me?.user.role === 'admin'} departments={departments} onDone={() => { setEditing(null); load(); }} />}
        {!goals ? (
          <Spinner />
        ) : goals.length === 0 ? (
          <p className="rounded-xl border border-dashed border-ink-200 bg-white p-6 text-center text-sm text-ink-500">{tl('No goals for this quarter.')}</p>
        ) : (
          goals.map((g) => <GoalCard key={g.id} g={g} canEdit={me?.user.role === 'admin' || g.owner_id === me?.user.id || (me?.user.role === 'dept_lead' && g.department_id === me.user.department_id)} onEdit={() => setEditing(g)} onChanged={load} />)
        )}
      </div>
    </Shell>
  );
}

function Bar({ label, value, tone = 'bg-accent-500' }: { label: string; value: number | null; tone?: string }) {
  return (
    <div>
      <div className="mb-0.5 flex justify-between text-xs text-ink-600">
        <span>{label}</span>
        <span>{value == null ? '-' : `${value}%`}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-ink-100">
        <div className={cx('h-full rounded-full transition-all', tone)} style={{ width: `${value ?? 0}%` }} />
      </div>
    </div>
  );
}

function GoalCard({ g, canEdit, onEdit, onChanged }: { g: Goal; canEdit: boolean; onEdit(): void; onChanged(): void }) {
  const navigate = useNavigate();
  const [checkin, setCheckin] = useState(false);
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const u = g.unit ? ` ${g.unit}` : '';

  return (
    <section className="rounded-xl border border-ink-100 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink-900">{g.title}</p>
          <p className="text-xs text-ink-500">
            {g.department ?? tl('Whole company')}
            {g.owner && ` · ${g.owner}`}
          </p>
        </div>
        <Badge tone={STATUS_TONE[g.status]}>{tl(g.status[0].toUpperCase() + g.status.slice(1))}</Badge>
        {canEdit && (
          <Button size="sm" variant="ghost" onClick={onEdit}>
            <Icon name="edit" className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      {g.description && <p className="mt-2 text-sm text-ink-700">{g.description}</p>}
      {g.metric && (
        <p className="mt-2 text-sm">
          <span className="text-ink-500">{g.metric}:</span> {g.baseline ?? '-'}
          {u} → <strong>{g.target ?? '-'}{u}</strong>
          <span className="text-ink-500"> · {tl('now')} </span>
          <strong>{g.current ?? '-'}{g.current != null ? u : ''}</strong>
          {g.current_from && <span className="text-xs text-ink-400"> ({g.current_from})</span>}
        </p>
      )}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Bar label={tl('Towards the target')} value={g.metric_progress} />
        <Bar label={g.tasks_total ? tl('Tasks done ({d} of {t})', { d: g.tasks_done, t: g.tasks_total }) : tl('Tasks done')} value={g.task_progress} tone="bg-emerald-500" />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!g.conversation_id ? (
          canEdit && (
            <Button
              size="sm"
              variant="primary"
              disabled={busy}
              title={tl('The council plans milestones per department; you then put the plan into action from the verdict.')}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await api<{ conversationId: string }>(`/api/goals/${g.id}/plan`, { method: 'POST' });
                  navigate(`/c/${r.conversationId}`);
                } catch (e) {
                  setError((e as Error).message);
                  setBusy(false);
                }
              }}
            >
              {busy ? <Spinner /> : <Icon name="spark" className="h-3.5 w-3.5" />} {tl('Plan with the council')}
            </Button>
          )
        ) : (
          <Link to={`/c/${g.conversation_id}`} className="text-sm font-medium text-accent-700 hover:underline">
            {g.council_status === 'done' ? tl("Open the council's plan") : tl('The council is planning: open it')}
          </Link>
        )}
        {g.conversation_id && !g.plan_id && g.council_status === 'done' && <span className="text-xs text-ink-500">{tl('Next: "Put into action" under the verdict to create the tasks.')}</span>}
        {g.plan_id && (
          <Link to={`/plans/${g.plan_id}`} className="text-sm font-medium text-accent-700 hover:underline">
            {tl('Open the tasks')}
          </Link>
        )}
        {canEdit && g.metric_source === 'manual' && g.metric && (
          <Button size="sm" variant="ghost" onClick={() => setCheckin(!checkin)}>
            {tl('Update the figure')}
          </Button>
        )}
      </div>
      {checkin && (
        <form
          className="mt-2 flex flex-wrap items-end gap-2 rounded-lg bg-ink-50 p-2"
          onSubmit={async (e) => {
            e.preventDefault();
            await api(`/api/goals/${g.id}/checkin`, { body: { value: value === '' ? null : Number(value), note } });
            setCheckin(false);
            setValue('');
            setNote('');
            onChanged();
          }}
        >
          <Field label={`${g.metric}${u ? ` (${g.unit})` : ''}`}>
            <input className={cx(inputCls, 'w-32 py-1')} type="number" step="any" value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
          <Field label={tl('Note')}>
            <input className={cx(inputCls, 'py-1')} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Button size="sm" variant="primary">{tl('Save')}</Button>
        </form>
      )}
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
    </section>
  );
}

function GoalForm({ goal, admin, departments, onDone }: { goal: Partial<Goal>; admin: boolean; departments: Array<{ id: string; name: string }>; onDone(): void }) {
  const [g, setG] = useState(goal);
  const [error, setError] = useState<string | null>(null);
  const num = (s: string) => (s === '' ? null : Number(s));
  const save = async () => {
    setError(null);
    const body = {
      title: g.title ?? '',
      description: g.description ?? '',
      quarter: g.quarter,
      department_id: g.department_id ?? null,
      metric_source: g.metric_source ?? 'manual',
      metric: g.metric_source && g.metric_source !== 'manual' ? (g.metric || (g.metric_source === 'npl_ratio' ? 'NPL ratio' : 'PAR30')) : g.metric ?? '',
      unit: g.metric_source && g.metric_source !== 'manual' ? '%' : g.unit ?? '',
      baseline: g.baseline ?? null,
      target: g.target ?? null,
      status: g.status ?? 'active',
    };
    try {
      if (g.id) await api(`/api/goals/${g.id}`, { method: 'PUT', body });
      else await api('/api/goals', { body });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <section className="space-y-3 rounded-xl border border-accent-200 bg-white p-4 shadow-sm">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label={tl('Goal')}>
          <input className={inputCls} value={g.title ?? ''} maxLength={200} placeholder={tl('e.g. Bring early arrears back under control')} onChange={(e) => setG({ ...g, title: e.target.value })} />
        </Field>
        {admin ? (
          <Field label={tl('For')}>
            <select className={inputCls} value={g.department_id ?? ''} onChange={(e) => setG({ ...g, department_id: e.target.value || null })}>
              <option value="">{tl('Whole company')}</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <div />
        )}
        <Field label={tl('Details (optional)')}>
          <textarea className={cx(inputCls, 'min-h-16 text-sm')} value={g.description ?? ''} maxLength={2000} onChange={(e) => setG({ ...g, description: e.target.value })} />
        </Field>
        <Field label={tl('How it is measured')}>
          <select className={inputCls} value={g.metric_source ?? 'manual'} onChange={(e) => setG({ ...g, metric_source: e.target.value as Source })}>
            {(Object.keys(SOURCE_LABEL) as Source[]).map((s) => (
              <option key={s} value={s}>
                {tl(SOURCE_LABEL[s])}
              </option>
            ))}
          </select>
        </Field>
        {(g.metric_source ?? 'manual') === 'manual' && (
          <>
            <Field label={tl('Measure')}>
              <input className={inputCls} value={g.metric ?? ''} maxLength={120} placeholder={tl('e.g. 1-30 → 31-60 DPD roll rate')} onChange={(e) => setG({ ...g, metric: e.target.value })} />
            </Field>
            <Field label={tl('Unit')}>
              <input className={inputCls} value={g.unit ?? ''} maxLength={20} placeholder="%, RM, accounts" onChange={(e) => setG({ ...g, unit: e.target.value })} />
            </Field>
          </>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label={tl('Starting value')}>
            <input className={inputCls} type="number" step="any" value={g.baseline ?? ''} onChange={(e) => setG({ ...g, baseline: num(e.target.value) })} />
          </Field>
          <Field label={tl('Target')}>
            <input className={inputCls} type="number" step="any" value={g.target ?? ''} onChange={(e) => setG({ ...g, target: num(e.target.value) })} />
          </Field>
        </div>
        {g.id && (
          <Field label={tl('Status')}>
            <select className={inputCls} value={g.status ?? 'active'} onChange={(e) => setG({ ...g, status: e.target.value as Goal['status'] })}>
              {(['active', 'achieved', 'missed', 'dropped'] as const).map((s) => (
                <option key={s} value={s}>
                  {tl(s[0].toUpperCase() + s.slice(1))}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <Button variant="primary" size="sm" disabled={(g.title ?? '').trim().length < 3} onClick={save}>
          {tl('Save goal')}
        </Button>
        <Button size="sm" onClick={onDone}>
          {tl('Cancel')}
        </Button>
        {g.id && (
          <Button
            size="sm"
            variant="danger"
            className="ml-auto"
            onClick={async () => {
              if (confirm(tl('Delete this goal?'))) {
                await api(`/api/goals/${g.id}`, { method: 'DELETE' });
                onDone();
              }
            }}
          >
            {tl('Delete')}
          </Button>
        )}
      </div>
    </section>
  );
}
