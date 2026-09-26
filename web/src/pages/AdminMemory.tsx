import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Markdown } from '../components/Markdown';
import { Badge, Button, cx, inputCls, Spinner } from '../components/ui';
import { tl } from '../i18n';

/**
 * Company memory: house rules (always given to the council), answers staff suggested for review,
 * approved answers (reused for similar questions), and the monthly improvement report.
 */
function useData<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    api<T>(path).then(setData).catch((e) => setError((e as Error).message));
  }, [path]);
  useEffect(reload, [reload]);
  return { data, error, reload };
}

function Section({ title, hint, children, actions }: { title: string; hint?: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="mb-6 rounded-xl border border-ink-100 bg-white">
      <header className="flex items-center justify-between gap-2 border-b border-ink-100 px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {actions}
      </header>
      <div className="p-4">
        {hint && <p className="mb-3 text-xs text-ink-500">{hint}</p>}
        {children}
      </div>
    </section>
  );
}

export default function CompanyMemory() {
  const { me } = useAuth();
  const isAdmin = me?.user.role === 'admin';
  return (
    <>
      <HouseRules isAdmin={isAdmin} />
      <Answers status="suggested" isAdmin={isAdmin} />
      <Answers status="approved" isAdmin={isAdmin} />
      {isAdmin && <LeadSetup />}
      {isAdmin && <Report />}
    </>
  );
}

interface Rule {
  id: string;
  text: string;
  department_id: string | null;
  department_name: string | null;
  is_active: boolean;
  created_by: string | null;
  can_edit: boolean;
}

function HouseRules({ isAdmin }: { isAdmin: boolean }) {
  const { departments, me } = useAuth();
  const rules = useData<Rule[]>('/api/memory/rules');
  const [text, setText] = useState('');
  const [dept, setDept] = useState<string>(me?.user.department_id ?? '');
  const [error, setError] = useState<string | null>(null);
  return (
    <Section
      title={tl('House rules')}
      hint={tl('Short facts the council must always follow for a department: definitions, limits, policies. Example: "Our NPL definition is 90 days past due; restructured loans are included." Keep each rule to one or two sentences.')}
    >
      <form
        className="mb-4 flex flex-wrap items-start gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            await api('/api/memory/rules', { body: { text, departmentId: dept === 'all' ? null : dept } });
            setText('');
            rules.reload();
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <textarea className={cx(inputCls, 'min-h-16 min-w-64 flex-1')} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} placeholder={tl('Write a rule…')} />
        <select className="rounded-lg border border-ink-200 bg-white px-2 py-2 text-sm" value={dept} onChange={(e) => setDept(e.target.value)} aria-label={tl('Department')}>
          {isAdmin && <option value="all">{tl('All departments')}</option>}
          {departments
            .filter((d) => isAdmin || d.id === me?.user.department_id)
            .map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
        </select>
        <Button variant="primary" disabled={text.trim().length < 5}>{tl('Add rule')}</Button>
        {error && <p className="w-full text-sm text-red-700">{error}</p>}
      </form>
      {!rules.data ? (
        <Spinner />
      ) : rules.data.length === 0 ? (
        <p className="text-sm text-ink-400">{tl('No house rules yet.')}</p>
      ) : (
        <ul className="divide-y divide-ink-100">
          {rules.data.map((r) => (
            <li key={r.id} className={cx('flex items-start gap-3 py-2 text-sm', !r.is_active && 'opacity-50')}>
              <Badge tone={r.department_id ? 'neutral' : 'blue'}>{r.department_name ?? tl('All departments')}</Badge>
              <p className="min-w-0 flex-1">{r.text}</p>
              {r.can_edit && (
                <span className="flex shrink-0 gap-1">
                  <Button size="sm" variant="ghost" onClick={async () => { await api(`/api/memory/rules/${r.id}`, { method: 'PATCH', body: { isActive: !r.is_active } }); rules.reload(); }}>
                    {r.is_active ? tl('Pause') : tl('Resume')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={async () => { if (confirm(tl('Delete this rule?'))) { await api(`/api/memory/rules/${r.id}`, { method: 'DELETE' }); rules.reload(); } }}>
                    {tl('Delete')}
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

interface Answer {
  id: string;
  question: string;
  answer: string;
  status: 'suggested' | 'approved' | 'rejected';
  note: string | null;
  department_id: string | null;
  department_name: string | null;
  suggested_by: string | null;
  reviewed_by: string | null;
  created_at: string;
}

function Answers({ status, isAdmin }: { status: 'suggested' | 'approved'; isAdmin: boolean }) {
  const list = useData<Answer[]>(`/api/memory/answers?status=${status}`);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const act = async (id: string, body: Record<string, unknown>) => {
    setError(null);
    try {
      await api(`/api/memory/answers/${id}`, { method: 'PATCH', body });
      setOpen(null);
      list.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Section
      title={status === 'suggested' ? tl('Suggested answers to review') : tl('Approved company answers')}
      hint={
        status === 'suggested'
          ? tl('Staff suggested these answers as useful for others. Approve (edit first if needed) to let the council reuse them for similar questions, or reject.')
          : tl('The council is shown these when someone asks something similar. Department answers are used for that department; company-wide ones for everyone.')
      }
    >
      {error && <p className="mb-2 text-sm text-red-700">{error}</p>}
      {!list.data ? (
        <Spinner />
      ) : list.data.length === 0 ? (
        <p className="text-sm text-ink-400">{status === 'suggested' ? tl('Nothing waiting for review.') : tl('No approved answers yet.')}</p>
      ) : (
        <ul className="space-y-2">
          {list.data.map((a) => (
            <li key={a.id} className="rounded-lg border border-ink-100 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={a.department_id ? 'neutral' : 'blue'}>{a.department_name ?? tl('Company-wide')}</Badge>
                <span className="min-w-0 flex-1 font-medium">{a.question.slice(0, 200)}</span>
                <Button size="sm" variant="ghost" onClick={() => { setOpen(open === a.id ? null : a.id); setDraft(a.answer); }}>
                  {open === a.id ? tl('Close') : status === 'suggested' ? tl('Review') : tl('View')}
                </Button>
              </div>
              <p className="mt-1 text-xs text-ink-400">
                {tl('Suggested by {name}', { name: a.suggested_by ?? '—' })} · {new Date(a.created_at).toLocaleDateString()}
                {a.note ? ` · “${a.note}”` : ''}
              </p>
              {open === a.id && (
                <div className="mt-3 space-y-2">
                  <textarea className={cx(inputCls, 'min-h-48 font-mono text-xs')} value={draft} onChange={(e) => setDraft(e.target.value)} />
                  <details className="text-xs text-ink-500">
                    <summary className="cursor-pointer">{tl('Preview')}</summary>
                    <div className="mt-2 rounded border border-ink-100 p-2"><Markdown text={draft} /></div>
                  </details>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="primary" onClick={() => act(a.id, { status: 'approved', ...(draft !== a.answer ? { answer: draft } : {}) })}>
                      {status === 'suggested' ? tl('Approve') : tl('Save changes')}
                    </Button>
                    {isAdmin && a.department_id && (
                      <Button size="sm" onClick={() => act(a.id, { status: 'approved', companyWide: true, ...(draft !== a.answer ? { answer: draft } : {}) })}>
                        {tl('Approve for everyone')}
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => act(a.id, { status: 'rejected' })}>
                      {status === 'suggested' ? tl('Reject') : tl('Retire')}
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

interface LeadProgress {
  id: string;
  name: string;
  email: string;
  department: string | null;
  last_login_at: string | null;
  reminders: number;
  done: number;
  total: number;
  missing: string[];
}

function LeadSetup() {
  const list = useData<LeadProgress[]>('/api/admin/onboarding');
  return (
    <Section
      title={tl('Department lead setup')}
      hint={tl('Each lead has a setup checklist on their home screen (house rules, knowledge, reviewing answers, a first council question, a first decision). Leads are reminded by notification and email until it is done, at most 3 times.')}
    >
      {!list.data ? (
        <Spinner />
      ) : list.data.length === 0 ? (
        <p className="text-sm text-ink-400">{tl('No department leads yet. Set Role → Department lead in Admin → Users.')}</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-500">
              <th className="py-1">{tl('Lead')}</th>
              <th className="py-1">{tl('Department')}</th>
              <th className="py-1">{tl('Progress')}</th>
              <th className="py-1">{tl('Still to do')}</th>
            </tr>
          </thead>
          <tbody>
            {list.data.map((l) => (
              <tr key={l.id} className="border-t border-ink-100 align-top">
                <td className="py-2 pr-2">
                  <p className="font-medium">{l.name}</p>
                  <p className="text-xs text-ink-400">{l.last_login_at ? tl('last sign-in {date}', { date: new Date(l.last_login_at).toLocaleDateString() }) : tl('never signed in')}</p>
                </td>
                <td className="py-2 pr-2">{l.department ?? '—'}</td>
                <td className="py-2 pr-2">
                  <Badge tone={l.done === l.total ? 'green' : l.done === 0 ? 'red' : 'amber'}>{l.done}/{l.total}</Badge>
                </td>
                <td className="py-2 text-xs text-ink-600">{l.missing.length ? l.missing.map((m) => tl(m)).join(' · ') : tl('All done')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

interface ReportData {
  days: number;
  feedback: Array<{ department: string; helpful: number; unhelpful: number }>;
  comments: Array<{ date: string; department: string; mode: string; comment: string }>;
  noSources: Array<{ department: string; answers: number; without_sources: number }>;
  pending: Array<{ department: string; n: number }>;
  noOutcome: number;
  stale: number;
  memory: { approved: number; rules: number; decisions: number; outcomes: number };
  latency: Array<{ mode: string; n: number; p90_seconds: number }>;
  suggestions: string[];
}

function Report() {
  const [days, setDays] = useState(30);
  const r = useData<ReportData>(`/api/memory/report?days=${days}`);
  const d = r.data;
  return (
    <Section
      title={tl('Improvement report')}
      hint={tl('Where the council is weak and what would make it better. Counts and the comments people chose to write; never the text of staff questions. Admins also get this by email on the 1st of each month.')}
      actions={
        <select className="rounded-lg border border-ink-200 bg-white px-2 py-1 text-xs" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label={tl('Period')}>
          {[30, 90, 180].map((n) => (
            <option key={n} value={n}>{tl('Last {n} days', { n })}</option>
          ))}
        </select>
      }
    >
      {!d ? (
        <Spinner />
      ) : (
        <div className="space-y-4 text-sm">
          <div className="grid gap-2 sm:grid-cols-4">
            {[
              [tl('House rules'), d.memory.rules],
              [tl('Approved answers'), d.memory.approved],
              [tl('Decisions'), d.memory.decisions],
              [tl('Outcomes recorded'), d.memory.outcomes],
            ].map(([label, n]) => (
              <div key={String(label)} className="rounded-lg bg-ink-50 p-3">
                <p className="text-xs text-ink-500">{label}</p>
                <p className="text-xl font-semibold tabular-nums">{n}</p>
              </div>
            ))}
          </div>
          {d.suggestions.length > 0 && (
            <div className="rounded-lg bg-amber-50 p-3">
              <p className="mb-1 font-medium text-amber-900">{tl('What to do')}</p>
              <ul className="list-disc space-y-1 pl-5 text-amber-900">{d.suggestions.map((s) => <li key={s}>{s}</li>)}</ul>
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <table className="text-sm">
              <thead><tr className="text-left text-xs text-ink-500"><th className="py-1">{tl('Department')}</th><th className="py-1 text-right">👍</th><th className="py-1 text-right">👎</th></tr></thead>
              <tbody>{d.feedback.map((f) => <tr key={f.department} className="border-t border-ink-100"><td className="py-1">{f.department}</td><td className="py-1 text-right">{f.helpful}</td><td className="py-1 text-right">{f.unhelpful}</td></tr>)}</tbody>
            </table>
            <table className="text-sm">
              <thead><tr className="text-left text-xs text-ink-500"><th className="py-1">{tl('Department')}</th><th className="py-1 text-right">{tl('Answers without sources')}</th></tr></thead>
              <tbody>{d.noSources.map((s) => <tr key={s.department} className="border-t border-ink-100"><td className="py-1">{s.department}</td><td className="py-1 text-right tabular-nums">{s.without_sources} / {s.answers}</td></tr>)}</tbody>
            </table>
          </div>
          {d.comments.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-ink-500">{tl('Recent "not helpful" comments')}</p>
              <ul className="space-y-1">{d.comments.map((c, i) => <li key={i} className="text-xs"><span className="text-ink-400">{c.date} · {c.department}:</span> {c.comment}</li>)}</ul>
            </div>
          )}
          <p className="text-xs text-ink-500">
            {tl('Speed (90% of answers within)')}: {d.latency.map((l) => `${l.mode} ${l.p90_seconds}s`).join(' · ') || '—'}
          </p>
        </div>
      )}
    </Section>
  );
}
