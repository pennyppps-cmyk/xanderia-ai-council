import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { OwnerPicker } from '../components/OwnerPicker';
import { Badge, Button, cx, Field, Icon, inputCls, Spinner } from '../components/ui';
import { statusLabel, tl } from '../i18n';
import type { Person } from '../types';
import { Shell } from './Plan';

type Frequency = 'weekly' | 'monthly' | 'quarterly';
interface Step {
  title: string;
  description: string;
  owner_type: 'human' | 'agent';
  owner_role: string;
  directory_id: string | null;
  owner?: Person | null;
  candidates?: Person[];
  due_day: number;
  depends_on: number[];
}
interface Routine {
  id?: string;
  name: string;
  description: string;
  department_id: string | null;
  frequency: Frequency;
  run_day: number;
  auto_launch: boolean;
  active: boolean;
  steps: Step[];
}
interface RoutineRow {
  id: string;
  name: string;
  frequency: Frequency;
  run_day: number;
  auto_launch: boolean;
  active: boolean;
  department: string | null;
  owner: string;
  steps: number;
  last_plan: { id: string; title: string; status: string; total: number; done: number } | null;
}

const FREQ: Record<Frequency, string> = { weekly: 'Every week', monthly: 'Every month', quarterly: 'Every quarter' };
const blankStep = (): Step => ({ title: '', description: '', owner_type: 'human', owner_role: '', directory_id: null, owner: null, due_day: 1, depends_on: [] });

/** Recurring routines: the monthly (weekly, quarterly) work that creates its own tasks. */
export default function RoutinesPage() {
  const { id } = useParams();
  if (id === 'new') return <RoutineEditor />;
  return id ? <RoutineEditor id={id} /> : <RoutineList />;
}

function RoutineList() {
  const { me } = useAuth();
  const [rows, setRows] = useState<RoutineRow[] | null>(null);
  useEffect(() => void api<RoutineRow[]>('/api/routines').then(setRows).catch(() => setRows([])), []);
  const lead = me?.user.role !== 'employee';
  return (
    <Shell title={tl('Routines')} right={lead ? <Link to="/routines/new" className="rounded-lg bg-ink-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-ink-800">{tl('New routine')}</Link> : undefined}>
      <p className="mb-4 max-w-3xl text-sm text-ink-600">
        {tl('Work that repeats every week, month or quarter. On the run day the routine creates its tasks, with owners and due dates, for you to approve (or sends them by itself). A step that depends on another is only sent once that one is done.')}
      </p>
      {!rows ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-ink-200 bg-white p-6 text-center text-sm text-ink-500">
          {lead ? tl('No routines yet. Create one, or paste an SOP and let the council turn it into a routine.') : tl('No routines yet. Your department lead can set them up.')}
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((r) => (
            <Link key={r.id} to={`/routines/${r.id}`} className="rounded-xl border border-ink-100 bg-white p-4 shadow-sm hover:border-accent-300">
              <div className="flex items-start gap-2">
                <p className="flex-1 font-semibold text-ink-900">{r.name}</p>
                {!r.active && <Badge>{tl('Paused')}</Badge>}
                {r.auto_launch && <Badge tone="blue">{tl('Sends by itself')}</Badge>}
              </div>
              <p className="mt-1 text-xs text-ink-500">
                {tl(FREQ[r.frequency])} · {tl('tasks created on working day {n}', { n: r.run_day })} · {tl('{n} steps', { n: r.steps })}
                {r.department && ` · ${r.department}`}
              </p>
              {r.last_plan && (
                <p className="mt-2 text-xs text-ink-600">
                  {tl('Latest')}: {r.last_plan.title} · {r.last_plan.done}/{r.last_plan.total} {tl('done')} · {statusLabel(r.last_plan.status)}
                </p>
              )}
            </Link>
          ))}
        </div>
      )}
    </Shell>
  );
}

function RoutineEditor({ id }: { id?: string }) {
  const navigate = useNavigate();
  const [r, setR] = useState<Routine | null>(id ? null : { name: '', description: '', department_id: null, frequency: 'monthly', run_day: 1, auto_launch: false, active: true, steps: [blankStep()] });
  const [history, setHistory] = useState<Array<{ id: string; title: string; status: string; total: number; done: number; overdue: number; created_at: string }>>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sop, setSop] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api<Omit<Routine, 'steps'> & { steps: Array<Step & { owner_name: string | null; owner_position: string | null }>; history: typeof history }>(`/api/routines/${id}`)
      .then((d) => {
        setR({
          ...d,
          steps: d.steps.map((s) => ({ ...s, owner: s.directory_id ? { id: s.directory_id, name: s.owner_name ?? '', position: s.owner_position ?? '', email: '' } : null })),
        });
        setHistory(d.history);
      })
      .catch((e) => setError((e as Error).message));
  }, [id]);

  if (!r) return <Shell title={tl('Routine')} back="/routines">{error ? <p className="text-sm text-red-700">{error}</p> : <Spinner />}</Shell>;

  const setStep = (i: number, patch: Partial<Step>) => setR({ ...r, steps: r.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const payload = () => ({
    name: r.name,
    description: r.description,
    department_id: r.department_id,
    frequency: r.frequency,
    run_day: r.run_day,
    auto_launch: r.auto_launch,
    active: r.active,
    steps: r.steps.map((s) => ({ title: s.title, description: s.description, owner_type: s.owner_type, owner_role: s.owner_role, directory_id: s.directory_id, due_day: s.due_day, depends_on: s.depends_on })),
  });

  async function run(name: string, fn: () => Promise<void>) {
    setBusy(name);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const save = () =>
    run('save', async () => {
      if (id) await api(`/api/routines/${id}`, { method: 'PUT', body: payload() });
      else navigate(`/routines/${(await api<{ id: string }>('/api/routines', { body: payload() })).id}`, { replace: true });
    });

  const runNow = () =>
    run('run', async () => {
      try {
        const x = await api<{ planId: string }>(`/api/routines/${id}/run`, { body: {} });
        navigate(`/plans/${x.planId}`);
      } catch (e) {
        if (e instanceof ApiError && e.status === 409 && confirm(tl('This period already has its tasks. Create them again anyway?'))) {
          const x = await api<{ planId: string }>(`/api/routines/${id}/run`, { body: { force: true } });
          navigate(`/plans/${x.planId}`);
        } else if (!(e instanceof ApiError && e.status === 409)) throw e;
      }
    });

  const fromSop = () =>
    run('sop', async () => {
      const d = await api<{ name: string; frequency: Frequency; run_day: number; steps: Array<Step & { candidates: Array<{ id: string; name: string; position: string }> }> }>('/api/routines/from-sop', { body: { text: sop } });
      setR({
        ...r,
        name: r.name || d.name,
        frequency: d.frequency,
        run_day: d.run_day,
        steps: d.steps.map((s) => {
          const cands = s.candidates.map((c) => ({ ...c, email: '' }));
          return { ...s, owner: cands.find((c) => c.id === s.directory_id) ?? null, candidates: cands };
        }),
      });
      setSop(null);
    });

  const valid = r.name.trim().length >= 3 && r.steps.length > 0 && r.steps.every((s) => s.title.trim().length >= 2);

  return (
    <Shell
      title={id ? r.name || tl('Routine') : tl('New routine')}
      back="/routines"
      right={
        id ? (
          <Button size="sm" onClick={runNow} disabled={busy !== null} title={tl("Create this period's tasks now, for your approval")}>
            {busy === 'run' ? <Spinner /> : <Icon name="send" className="h-3.5 w-3.5" />} {tl('Run now')}
          </Button>
        ) : undefined
      }
    >
      <div className="mx-auto max-w-5xl space-y-4">
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <section className="rounded-xl border border-ink-100 bg-white p-4 shadow-sm">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={tl('Name')}>
              <input className={inputCls} value={r.name} maxLength={120} placeholder={tl('e.g. Month-end Angkasa deduction reconciliation')} onChange={(e) => setR({ ...r, name: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={tl('Repeats')}>
                <select className={inputCls} value={r.frequency} onChange={(e) => setR({ ...r, frequency: e.target.value as Frequency })}>
                  {(Object.keys(FREQ) as Frequency[]).map((f) => (
                    <option key={f} value={f}>
                      {tl(FREQ[f])}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={tl('Create tasks on working day')} hint={tl('1 = the first working day of the period')}>
                <input className={inputCls} type="number" min={1} max={20} value={r.run_day} onChange={(e) => setR({ ...r, run_day: Number(e.target.value) || 1 })} />
              </Field>
            </div>
            <Field label={tl('Why this routine matters (goes into the task emails)')}>
              <textarea className={cx(inputCls, 'min-h-16 text-sm')} maxLength={2000} value={r.description} onChange={(e) => setR({ ...r, description: e.target.value })} />
            </Field>
            <div className="space-y-2 self-end pb-1 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" className="accent-accent-600" checked={r.auto_launch} onChange={(e) => setR({ ...r, auto_launch: e.target.checked })} />
                {tl('Send the tasks by themselves (no approval each cycle)')}
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" className="accent-accent-600" checked={r.active} onChange={(e) => setR({ ...r, active: e.target.checked })} />
                {tl('Active')}
              </label>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-ink-100 bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="flex-1 text-sm font-semibold">{tl('Steps')}</h2>
            <Button size="sm" onClick={() => setSop(sop === null ? '' : null)}>
              <Icon name="spark" className="h-3.5 w-3.5" /> {tl('Draft from an SOP')}
            </Button>
          </div>
          {sop !== null && (
            <div className="mb-4 space-y-2 rounded-lg border border-accent-100 bg-accent-50 p-3">
              <p className="text-xs text-ink-600">{tl('Paste the SOP. The council turns it into steps with owners and due days; check them before saving. This replaces the steps below.')}</p>
              <textarea className={cx(inputCls, 'min-h-40 text-sm')} value={sop} onChange={(e) => setSop(e.target.value)} maxLength={20000} />
              <Button size="sm" variant="primary" disabled={sop.trim().length < 40 || busy !== null} onClick={fromSop}>
                {busy === 'sop' && <Spinner />} {tl('Turn into steps')}
              </Button>
            </div>
          )}
          <ol className="space-y-3">
            {r.steps.map((s, i) => (
              <li key={i} className="rounded-lg border border-ink-100 bg-ink-50 p-3">
                <div className="flex flex-wrap items-start gap-2">
                  <span className="pt-2 text-sm font-semibold text-ink-400">{i + 1}.</span>
                  <div className="min-w-0 flex-1 space-y-2">
                    <input className={cx(inputCls, 'py-1.5 font-medium')} value={s.title} maxLength={200} placeholder={tl('What needs doing')} onChange={(e) => setStep(i, { title: e.target.value })} />
                    <textarea className={cx(inputCls, 'min-h-12 py-1.5 text-sm')} value={s.description} maxLength={1000} placeholder={tl('What "done" looks like')} onChange={(e) => setStep(i, { description: e.target.value })} />
                  </div>
                  <span className="flex gap-1">
                    <Button size="sm" variant="ghost" disabled={i === 0} title={tl('Move up')} onClick={() => { const l = [...r.steps]; [l[i - 1], l[i]] = [l[i], l[i - 1]]; setR({ ...r, steps: l.map((x) => ({ ...x, depends_on: [] })) }); }}>↑</Button>
                    <Button size="sm" variant="ghost" disabled={r.steps.length <= 1} title={tl('Remove')} onClick={() => setR({ ...r, steps: r.steps.filter((_, j) => j !== i).map((x) => ({ ...x, depends_on: x.depends_on.filter((d) => d !== i + 1).map((d) => (d > i + 1 ? d - 1 : d)) })) })}>
                      <Icon name="trash" className="h-3.5 w-3.5" />
                    </Button>
                  </span>
                </div>
                <div className="mt-2 grid gap-2 pl-6 md:grid-cols-[1fr_1fr_8rem]">
                  <div>
                    <div className="mb-1 inline-flex overflow-hidden rounded-md border border-ink-200 text-xs">
                      {(['human', 'agent'] as const).map((t) => (
                        <button key={t} type="button" onClick={() => setStep(i, { owner_type: t })} className={cx('px-2 py-0.5', s.owner_type === t ? 'bg-ink-900 text-white' : 'bg-white')}>
                          {t === 'human' ? tl('Person') : tl('AI Runner drafts it')}
                        </button>
                      ))}
                    </div>
                    {s.owner_type === 'agent' && <p className="mb-1 text-xs text-ink-500">{tl('Then the draft goes to:')}</p>}
                    {(
                      <OwnerPicker value={s.owner ?? null} candidates={s.candidates ?? []} onChange={(p) => setStep(i, { owner: p, directory_id: p.id, owner_role: s.owner_role || p.position })} />
                    )}
                    {s.owner_type === 'human' && !s.directory_id && s.owner_role && <p className="mt-1 text-xs text-ink-500">{tl('Suggested owner: {role}', { role: s.owner_role })}</p>}
                  </div>
                  <Field label={tl('Depends on steps')}>
                    <div className="flex flex-wrap gap-1">
                      {r.steps.slice(0, i).map((_, d) => (
                        <label key={d} className={cx('cursor-pointer rounded-md border px-2 py-0.5 text-xs', s.depends_on.includes(d + 1) ? 'border-accent-400 bg-accent-50 text-accent-800' : 'border-ink-200 bg-white')}>
                          <input
                            type="checkbox"
                            className="sr-only"
                            checked={s.depends_on.includes(d + 1)}
                            onChange={(e) => setStep(i, { depends_on: e.target.checked ? [...s.depends_on, d + 1].sort() : s.depends_on.filter((x) => x !== d + 1) })}
                          />
                          {d + 1}
                        </label>
                      ))}
                      {i === 0 && <span className="text-xs text-ink-400">{tl('none')}</span>}
                    </div>
                  </Field>
                  <Field label={tl('Due on working day')}>
                    <input className={cx(inputCls, 'py-1')} type="number" min={1} max={60} value={s.due_day} onChange={(e) => setStep(i, { due_day: Number(e.target.value) || 1 })} />
                  </Field>
                </div>
              </li>
            ))}
          </ol>
          <Button size="sm" className="mt-3" disabled={r.steps.length >= 25} onClick={() => setR({ ...r, steps: [...r.steps, { ...blankStep(), due_day: r.steps[r.steps.length - 1]?.due_day ?? 1 }] })}>
            <Icon name="plus" className="h-3.5 w-3.5" /> {tl('Add step')}
          </Button>
        </section>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={!valid || busy !== null} onClick={save}>
            {busy === 'save' && <Spinner />} {tl('Save routine')}
          </Button>
          {id && (
            <Button
              variant="danger"
              className="ml-auto"
              disabled={busy !== null}
              onClick={() => confirm(tl('Delete this routine? Tasks already created are kept.')) && run('delete', async () => { await api(`/api/routines/${id}`, { method: 'DELETE' }); navigate('/routines'); })}
            >
              <Icon name="trash" className="h-4 w-4" /> {tl('Delete')}
            </Button>
          )}
        </div>

        {history.length > 0 && (
          <section className="rounded-xl border border-ink-100 bg-white p-4 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold">{tl('Cycles')}</h2>
            <ul className="divide-y divide-ink-100 text-sm">
              {history.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center gap-2 py-2">
                  <Link to={`/plans/${h.id}`} className="flex-1 font-medium text-accent-700 hover:underline">
                    {h.title}
                  </Link>
                  <span className="text-xs text-ink-500">
                    {h.done}/{h.total} {tl('done')}
                  </span>
                  {h.overdue > 0 && <Badge tone="red">{tl('{n} overdue', { n: h.overdue })}</Badge>}
                  <Badge tone={h.status === 'done' ? 'green' : h.status === 'launched' ? 'blue' : 'neutral'}>{statusLabel(h.status)}</Badge>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Shell>
  );
}
