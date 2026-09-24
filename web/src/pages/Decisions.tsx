import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { VerdictCard } from '../components/AssistantMessage';
import { Markdown } from '../components/Markdown';
import { Badge, Button, cx, Field, inputCls, Spinner } from '../components/ui';
import { tl } from '../i18n';
import type { Verdict } from '../types';
import { Shell } from './Plan';

interface DecisionRow {
  id: string;
  message_id: string;
  title: string;
  summary: string;
  visibility: 'department' | 'company';
  status: 'decided' | 'in_progress' | 'done' | 'dropped';
  decided_at: string;
  next_check_in: string | null;
  department_name: string | null;
  recorded_by_name: string;
  latest_outcome: { rating: Rating; note: string | null; created_at: string } | null;
  plan: { id: string; status: string; total: number; done: number } | null;
}
type Rating = 'worked' | 'partly' | 'did_not_work' | 'too_early';

const RATING: Record<Rating, { label: string; tone: 'green' | 'amber' | 'red' | 'neutral' }> = {
  worked: { label: 'Worked', tone: 'green' },
  partly: { label: 'Partly worked', tone: 'amber' },
  did_not_work: { label: 'Did not work', tone: 'red' },
  too_early: { label: 'Too early to tell', tone: 'neutral' },
};
const STATUS_LABEL: Record<DecisionRow['status'], string> = { decided: 'Decided', in_progress: 'In progress', done: 'Done', dropped: 'Dropped' };
const kl = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

/** Decision register: list + detail + meeting brief. */
export default function DecisionsPage() {
  const { id } = useParams();
  return id ? <DecisionDetail id={id} /> : <DecisionList />;
}

function DecisionList() {
  const { departments } = useAuth();
  const [rows, setRows] = useState<DecisionRow[] | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [dept, setDept] = useState('');
  const [brief, setBrief] = useState<{ open: boolean; from: string; to: string; busy: boolean; md: string | null; error: string | null }>({
    open: false,
    from: new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10),
    to: kl(),
    busy: false,
    md: null,
    error: null,
  });

  const load = useCallback(() => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (status) p.set('status', status);
    if (dept) p.set('department', dept);
    api<DecisionRow[]>(`/api/decisions?${p}`).then(setRows).catch(() => setRows([]));
  }, [q, status, dept]);
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  async function makeBrief() {
    setBrief((b) => ({ ...b, busy: true, md: null, error: null }));
    try {
      const r = await api<{ markdown: string }>('/api/decisions/brief', { body: { from: brief.from, to: brief.to, department: dept || undefined } });
      setBrief((b) => ({ ...b, busy: false, md: r.markdown }));
    } catch (e) {
      setBrief((b) => ({ ...b, busy: false, error: (e as Error).message }));
    }
  }

  return (
    <Shell title={tl('Decision register')}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <input className={cx(inputCls, 'max-w-xs')} placeholder={tl('Search decisions')} value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="rounded-lg border border-ink-200 px-2 py-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{tl('All statuses')}</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {tl(v)}
              </option>
            ))}
          </select>
          <select className="rounded-lg border border-ink-200 px-2 py-2 text-sm" value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="">{tl('All departments')}</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <Button className="ml-auto" onClick={() => setBrief((b) => ({ ...b, open: !b.open }))}>
            {tl('Meeting brief')}
          </Button>
        </div>

        {brief.open && (
          <section className="rounded-xl border border-accent-100 bg-white p-4">
            <p className="mb-2 text-xs text-ink-400">{tl('A one-page brief of the decisions in a period, for a management meeting. Only decisions you can see are included.')}</p>
            <div className="flex flex-wrap items-end gap-2">
              <Field label={tl('From')}>
                <input type="date" className={inputCls} value={brief.from} onChange={(e) => setBrief({ ...brief, from: e.target.value })} />
              </Field>
              <Field label={tl('To')}>
                <input type="date" className={inputCls} value={brief.to} onChange={(e) => setBrief({ ...brief, to: e.target.value })} />
              </Field>
              <Button variant="primary" disabled={brief.busy} onClick={makeBrief}>
                {brief.busy && <Spinner />} {tl('Write brief')}
              </Button>
              {brief.md && (
                <Button onClick={() => navigator.clipboard.writeText(brief.md!)}>{tl('Copy')}</Button>
              )}
            </div>
            {brief.error && <p className="mt-2 text-sm text-red-700">{brief.error}</p>}
            {brief.md && (
              <div className="mt-3 rounded-lg border border-ink-100 bg-ink-50 p-3">
                <Markdown text={brief.md} />
              </div>
            )}
          </section>
        )}

        {!rows ? (
          <Spinner className="h-5 w-5 text-ink-400" />
        ) : rows.length === 0 ? (
          <p className="rounded-xl border border-ink-100 bg-white p-4 text-sm text-ink-400">
            {tl('No decisions yet. Open a council verdict and press “Record as decision”.')}
          </p>
        ) : (
          <ul className="divide-y divide-ink-100 rounded-xl border border-ink-100 bg-white">
            {rows.map((d) => (
              <li key={d.id}>
                <Link to={`/decisions/${d.id}`} className="flex flex-wrap items-start gap-3 px-4 py-3 hover:bg-ink-50">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink-900">{d.title}</p>
                    <p className="text-xs text-ink-400">
                      {d.department_name ?? '—'} · {new Date(d.decided_at).toLocaleDateString()} · {d.recorded_by_name}
                      {d.visibility === 'company' ? ` · ${tl('company-wide')}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <Badge tone={d.status === 'done' ? 'green' : d.status === 'dropped' ? 'red' : 'blue'}>{tl(STATUS_LABEL[d.status])}</Badge>
                    {d.plan && <Badge>{tl('plan {done}/{total}', { done: d.plan.done, total: d.plan.total })}</Badge>}
                    {d.latest_outcome && <Badge tone={RATING[d.latest_outcome.rating].tone}>{tl(RATING[d.latest_outcome.rating].label)}</Badge>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Shell>
  );
}

function DecisionDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const [d, setD] = useState<(DecisionRow & { verdict: Verdict | null; outcomes: Array<{ rating: Rating; note: string | null; created_at: string; by: string }>; can_edit: boolean }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rating, setRating] = useState<Rating>('worked');
  const [note, setNote] = useState('');
  const load = useCallback(() => {
    api<any>(`/api/decisions/${id}`).then(setD).catch((e) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);

  if (error) return <Shell title={tl('Decision')} back="/decisions"><p className="text-sm text-red-700">{error}</p></Shell>;
  if (!d) return <Shell title={tl('Decision')} back="/decisions"><Spinner className="h-5 w-5 text-ink-400" /></Shell>;

  const patch = async (body: object) => {
    await api(`/api/decisions/${id}`, { method: 'PATCH', body });
    load();
  };

  return (
    <Shell title={d.title} back="/decisions">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-600">
          <span>
            {d.department_name ?? '—'} · {tl('decided')} {new Date(d.decided_at).toLocaleDateString()} · {d.recorded_by_name}
          </span>
          {d.next_check_in && <Badge>{tl('next check-in {date}', { date: new Date(d.next_check_in).toLocaleDateString() })}</Badge>}
          {d.plan && (
            <Link to={`/plans/${d.plan.id}`} className="text-accent-700 hover:underline">
              {tl('Action plan: {done}/{total} done', { done: d.plan.done, total: d.plan.total })}
            </Link>
          )}
          {d.can_edit && (
            <span className="ml-auto flex flex-wrap gap-2">
              <select className="rounded border border-ink-200 px-2 py-1" value={d.status} onChange={(e) => patch({ status: e.target.value })}>
                {Object.entries(STATUS_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {tl(v)}
                  </option>
                ))}
              </select>
              <select className="rounded border border-ink-200 px-2 py-1" value={d.visibility} onChange={(e) => patch({ visibility: e.target.value })}>
                <option value="department">{tl('Visible to my department')}</option>
                <option value="company">{tl('Visible company-wide')}</option>
              </select>
            </span>
          )}
        </div>

        {d.verdict ? <VerdictCard verdict={d.verdict} onFollowUp={() => navigate('/')} /> : <Markdown text={d.summary} />}

        <section className="rounded-xl border border-ink-100 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold">{tl('Outcome')}</h2>
          {d.outcomes.length === 0 && <p className="text-sm text-ink-400">{tl('No outcome recorded yet.')}</p>}
          <ul className="space-y-2">
            {d.outcomes.map((o, i) => (
              <li key={i} className="text-sm">
                <Badge tone={RATING[o.rating].tone}>{tl(RATING[o.rating].label)}</Badge>{' '}
                <span className="text-xs text-ink-400">
                  {new Date(o.created_at).toLocaleDateString()} · {o.by}
                </span>
                {o.note && <p className="mt-0.5 text-ink-700">{o.note}</p>}
              </li>
            ))}
          </ul>
          {d.can_edit && (
            <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-ink-100 pt-3">
              <select className="rounded-lg border border-ink-200 px-2 py-2 text-sm" value={rating} onChange={(e) => setRating(e.target.value as Rating)}>
                {Object.entries(RATING).map(([k, v]) => (
                  <option key={k} value={k}>
                    {tl(v.label)}
                  </option>
                ))}
              </select>
              <input className={cx(inputCls, 'min-w-0 flex-1')} placeholder={tl('What happened? Numbers help (e.g. roll rate fell from 8% to 6%).')} value={note} onChange={(e) => setNote(e.target.value)} />
              <Button
                variant="primary"
                onClick={async () => {
                  await api(`/api/decisions/${id}/outcomes`, { body: { rating, note: note || undefined } });
                  setNote('');
                  load();
                }}
              >
                {tl('Record outcome')}
              </Button>
            </div>
          )}
        </section>
      </div>
    </Shell>
  );
}

/** Button under a verdict: record it in the register (or show that it is). */
export function RecordDecision({ messageId }: { messageId: string }) {
  const [state, setState] = useState<{ id: string } | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ id: string }>(`/api/messages/${messageId}/decision`).then(setState).catch(() => setState(null));
  }, [messageId]);
  if (state === undefined) return null;
  if (state)
    return (
      <Link to={`/decisions/${state.id}`} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-accent-700 hover:bg-accent-50">
        ✓ {tl('In decision register')}
      </Link>
    );
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={busy}
      title={tl('Add this verdict to the decision register; the council will check in after 30 and 60 days')}
      onClick={async () => {
        setBusy(true);
        setState(await api<{ id: string }>(`/api/messages/${messageId}/decision`, { body: {} }));
      }}
    >
      {tl('Record as decision')}
    </Button>
  );
}
