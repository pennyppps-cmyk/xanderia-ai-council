import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { CrewPanel } from '../components/CrewPanel';
import { Markdown } from '../components/Markdown';
import { LanguageToggle } from '../components/LanguageToggle';
import { OwnerPicker } from '../components/OwnerPicker';
import { Badge, Button, cx, Icon, Spinner } from '../components/ui';
import type { CrewTask, Person, PlanSummary } from '../types';
import { statusLabel, tl } from '../i18n';

interface PlanData {
  plan: PlanSummary & { requester_id: string };
  tasks: CrewTask[];
}

interface DraftEdit {
  approved: boolean;
  owner: Person | null;
  owner_type: 'human' | 'agent';
  due_date: string | null;
  email_body: string;
}

const COLUMNS: Array<{ key: string; label: string; statuses: string[] }> = [
  { key: 'sent', label: 'Sent', statuses: ['sent'] },
  { key: 'accepted', label: 'Accepted', statuses: ['accepted'] },
  { key: 'progress', label: 'In progress', statuses: ['in_progress', 'running', 'review'] },
  { key: 'blocked', label: 'Blocked', statuses: ['blocked', 'cant_do'] },
  { key: 'done', label: 'Done', statuses: ['done'] },
];

const today = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

export default function PlanPage() {
  const { id } = useParams();
  const [data, setData] = useState<PlanData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, DraftEdit>>({});
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const d = await api<PlanData>(`/api/plans/${id}`);
      setData(d);
      setEdits((prev) => {
        const next: Record<string, DraftEdit> = {};
        for (const t of d.tasks.filter((t) => t.status === 'draft')) {
          next[t.id] = prev[t.id] ?? {
            approved: t.owner_type === 'agent' || Boolean(t.directory_id),
            owner: t.directory_id ? { id: t.directory_id, name: t.owner_name!, position: t.owner_position!, email: t.owner_email! } : null,
            owner_type: t.owner_type,
            due_date: t.due_date,
            email_body: t.email_body ?? '',
          };
        }
        return next;
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load, tick]);

  useEffect(() => {
    if (!data) return;
    const live = ['planning', 'launched'].includes(data.plan.status);
    const t = setInterval(() => setTick((n) => n + 1), live ? (data.plan.status === 'planning' ? 3000 : 10_000) : 30_000);
    return () => clearInterval(t);
  }, [data?.plan.status]);

  const drafts = useMemo(() => data?.tasks.filter((t) => t.status === 'draft') ?? [], [data]);
  const board = useMemo(() => data?.tasks.filter((t) => t.status !== 'draft' && t.status !== 'cancelled') ?? [], [data]);

  if (error) return <Shell title={tl("Action plan")}><p className="text-sm text-red-700">{error}</p></Shell>;
  if (!data) return <Shell title={tl("Action plan")}><Spinner className="h-5 w-5 text-ink-400" /></Shell>;
  const { plan } = data;
  const pct = plan.total ? Math.round((plan.done / plan.total) * 100) : 0;

  async function launch(onlyApproved: boolean) {
    setBusy(true);
    setFlash(null);
    try {
      const tasks = drafts.map((t) => {
        const e = edits[t.id];
        return {
          id: t.id,
          approved: onlyApproved ? e.approved : e.owner_type === 'agent' || Boolean(e.owner),
          directory_id: e.owner_type === 'agent' ? null : e.owner?.id ?? null,
          owner_type: e.owner_type,
          due_date: e.due_date,
          email_body: e.email_body,
        };
      });
      const r = await api<{ queued: number; blocked: number; agentTasks: string[] }>(`/api/plans/${id}/launch`, { body: { tasks } });
      setFlash(
        tl('{n} email(s) queued', { n: r.queued }) +
          (r.blocked ? `, ${tl('{n} blocked (recipient outside the allowed email domains)', { n: r.blocked })}` : '') +
          (r.agentTasks.length ? `, ${tl('{n} task(s) handed to the Runner', { n: r.agentTasks.length })}` : '') +
          `. ${tl('Emails go out during business hours.')}`,
      );
      setTick((n) => n + 1);
    } catch (e) {
      setFlash((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const set = (taskId: string, patch: Partial<DraftEdit>) => setEdits((all) => ({ ...all, [taskId]: { ...all[taskId], ...patch } }));

  return (
    <Shell
      title={plan.title}
      back={`/c/${plan.conversation_id}`}
      right={
        <Badge tone={plan.status === 'done' ? 'green' : plan.status === 'error' ? 'red' : plan.status === 'launched' ? 'blue' : 'neutral'}>
          {statusLabel(plan.status)}
        </Badge>
      }
    >
      <div className="space-y-4">
        <CrewPanel refreshKey={tick} />

        {plan.total > 0 && plan.status !== 'planning' && (
          <div>
            <div className="mb-1 flex justify-between text-xs text-ink-600">
              <span>
                {plan.done} {tl("of")} {plan.total} {tl("tasks done")}{plan.overdue ? ` · ${tl('{n} overdue', { n: plan.overdue })}` : ''}
              </span>
              <span>{pct}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-ink-100">
              <div className="h-full rounded-full bg-accent-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}

        {plan.status === 'planning' && (
          <div className="flex items-center gap-2 rounded-xl border border-ink-100 bg-white p-4 text-sm text-ink-600">
            <Spinner className="h-4 w-4 text-accent-600" /> {tl("The Dispatcher is turning the verdict into tasks and the Herald is drafting emails. This takes about a minute.")}
          </div>
        )}

        {plan.status === 'error' && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <p className="font-medium">{tl("Planning failed.")}</p>
            <p className="mt-1">{plan.error}</p>
            <Button
              size="sm"
              variant="danger"
              className="mt-3"
              onClick={async () => {
                const r = await api<{ id: string }>(`/api/messages/${plan.message_id}/plan`, { method: 'POST' });
                window.location.assign(`/plans/${r.id}`);
              }}
            >
              <Icon name="retry" /> {tl("Try again")}
            </Button>
          </div>
        )}

        {flash && <p className="rounded-lg bg-accent-50 px-3 py-2 text-sm text-accent-700">{flash}</p>}

        {drafts.length > 0 && (
          <section className="rounded-xl border border-ink-100 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold">{tl("Launch plan")}</h2>
                <p className="text-xs text-ink-400">
                  {tl("Check owners, dates and emails. Nothing is sent until you approve. Emails go only to staff in the directory, during business hours.")}
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" disabled={busy} onClick={() => launch(true)}>
                  {tl("Send approved")}
                </Button>
                <Button size="sm" variant="primary" disabled={busy} onClick={() => launch(false)}>
                  {busy && <Spinner className="h-3.5 w-3.5" />} {tl("Approve & send all")}
                </Button>
              </div>
            </div>
            <ul className="divide-y divide-ink-100">
              {drafts.map((t) => (
                <DraftRow key={t.id} task={t} edit={edits[t.id]} onChange={(p) => set(t.id, p)} />
              ))}
            </ul>
          </section>
        )}

        {board.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-semibold">{tl("Task board")}</h2>
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
              {COLUMNS.map((col) => {
                const items = board.filter((t) => col.statuses.includes(t.status));
                return (
                  <div key={col.key} className="rounded-xl bg-ink-100/60 p-2">
                    <p className="mb-2 px-1 text-xs font-semibold text-ink-600">
                      {tl(col.label)} <span className="font-normal text-ink-400">{items.length}</span>
                    </p>
                    <div className="space-y-2">
                      {items.map((t) => (
                        <TaskCard key={t.id} task={t} onChanged={() => setTick((n) => n + 1)} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <p className="text-center text-[11px] text-ink-400">
          <Link to="/tasks" className="underline">
            {tl("All my plans and tasks")}
          </Link>
        </p>
      </div>
    </Shell>
  );
}

function DraftRow({ task: t, edit, onChange }: { task: CrewTask; edit?: DraftEdit; onChange(p: Partial<DraftEdit>): void }) {
  const [showEmail, setShowEmail] = useState(false);
  if (!edit) return null;
  const isAgent = edit.owner_type === 'agent';
  return (
    <li className="grid gap-3 px-4 py-3 lg:grid-cols-[1fr_16rem_9rem_6rem]">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink-900">
          <span className="text-ink-400">{t.seq}.</span> {t.title}
        </p>
        <p className="text-xs text-ink-600">{t.description}</p>
        <p className="mt-1 text-[11px] text-ink-400">
          {tl("Suggested owner:")} {t.owner_role}
          {t.depends_on.length > 0 && ` · ${tl('after step {n}', { n: t.depends_on.join(', ') })}`}
        </p>
        {!isAgent && (
          <button className="mt-1 text-xs font-medium text-accent-700 hover:underline" onClick={() => setShowEmail((s) => !s)}>
            {showEmail ? tl('Hide email') : tl('Preview / edit email')}
          </button>
        )}
        {showEmail && !isAgent && (
          <div className="mt-2 rounded-lg border border-ink-100 bg-ink-50 p-2">
            <p className="mb-1 text-xs text-ink-600">
              <span className="font-semibold">{tl("Subject:")}</span> {t.email_subject}
            </p>
            <textarea
              value={edit.email_body}
              onChange={(e) => onChange({ email_body: e.target.value })}
              rows={6}
              className="w-full rounded-md border border-ink-200 bg-white p-2 text-sm focus:border-accent-600 focus:outline-none"
            />
            <p className="text-[11px] text-ink-400">{tl("Accept / Need help / Mark done / Can't do buttons and the task details are added automatically. Personal data is removed before sending.")}</p>
          </div>
        )}
      </div>
      <div>
        <div className="mb-1 inline-flex rounded-md bg-ink-100 p-0.5 text-[11px]">
          {(['human', 'agent'] as const).map((k) => (
            <button
              key={k}
              onClick={() => onChange({ owner_type: k, approved: k === 'agent' ? true : Boolean(edit.owner) })}
              className={cx('rounded px-2 py-0.5 font-medium', edit.owner_type === k ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-600')}
            >
              {k === 'human' ? tl('Person') : tl('AI Runner drafts it')}
            </button>
          ))}
        </div>
        {isAgent ? (
          <p className="rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-800">{tl("The Runner writes a draft for you to review. Nothing is sent.")}</p>
        ) : (
          <OwnerPicker value={edit.owner} candidates={t.candidates} onChange={(p) => onChange({ owner: p, approved: true })} />
        )}
      </div>
      <label className="text-xs text-ink-600">
        {tl("Due")}
        <input
          type="date"
          value={edit.due_date ?? ''}
          min={today()}
          onChange={(e) => onChange({ due_date: e.target.value || null })}
          className="mt-0.5 block w-full rounded-lg border border-ink-200 px-2 py-1.5 text-sm"
        />
      </label>
      <label className="flex items-center gap-2 self-center text-sm" title={!isAgent && !edit.owner ? tl('Choose an owner first') : undefined}>
        <input
          type="checkbox"
          className="accent-accent-600"
          disabled={!isAgent && !edit.owner}
          checked={edit.approved && (isAgent || Boolean(edit.owner))}
          onChange={(e) => onChange({ approved: e.target.checked })}
        />
        {tl("Approve")}
      </label>
    </li>
  );
}

function TaskCard({ task: t, onChanged }: { task: CrewTask; onChanged(): void }) {
  const [reassign, setReassign] = useState(false);
  const [showDraft, setShowDraft] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const overdue = t.due_date && t.due_date < today() && !['done', 'cant_do'].includes(t.status);
  const lastEmail = t.emails?.[t.emails.length - 1];

  const act = async (path: string, body: object) => {
    setErr(null);
    try {
      await api(path, { body });
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className={cx('rounded-lg border bg-white p-2.5 text-sm shadow-sm', overdue ? 'border-red-200' : 'border-ink-100')}>
      <p className="font-medium text-ink-900">{t.title}</p>
      <p className="mt-0.5 text-xs text-ink-600">
        {t.owner_type === 'agent' ? tl('AI Runner') : t.owner_name ?? tl('Unassigned')}
        {t.owner_position ? ` · ${t.owner_position}` : ''}
      </p>
      <div className="mt-1 flex flex-wrap gap-1">
        {t.due_date && <Badge tone={overdue ? 'red' : 'neutral'}>{tl("due")} {t.due_date}</Badge>}
        {t.status === 'cant_do' && <Badge tone="red">{tl("can't do")}</Badge>}
        {t.status === 'review' && <Badge tone="green">{tl("draft ready")}</Badge>}
        {t.status === 'running' && <Badge tone="blue">{tl("Runner drafting…")}</Badge>}
        {lastEmail && t.owner_type === 'human' && (
          <Badge tone={lastEmail.status === 'blocked' || lastEmail.status === 'failed' ? 'red' : 'neutral'} title={tl('Last email to {to}', { to: lastEmail.to })}>
            {tl(`${lastEmail.kind} email`)} {lastEmail.status === 'queued' ? tl('queued') : lastEmail.status === 'logged' ? tl('in outbox') : tl(lastEmail.status)}
          </Badge>
        )}
      </div>
      {t.response_note && <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">“{t.response_note}”</p>}

      {t.escalation_state === 'pending' && (
        <div className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-800">
          {tl("Overdue. Escalate to {name}'s manager ({email})?", { name: t.owner_name ?? '', email: t.manager_email ?? '' })}
          <div className="mt-1 flex gap-1">
            <Button size="sm" variant="danger" onClick={() => act(`/api/tasks/${t.id}/escalation`, { approve: true })}>
              {tl("Escalate")}
            </Button>
            <Button size="sm" onClick={() => act(`/api/tasks/${t.id}/escalation`, { approve: false })}>
              {tl("Not now")}
            </Button>
          </div>
        </div>
      )}

      {t.status === 'review' && (
        <div className="mt-2">
          <button className="text-xs font-medium text-accent-700 hover:underline" onClick={() => setShowDraft((s) => !s)}>
            {showDraft ? tl('Hide draft') : tl('Review draft')}
          </button>
          {showDraft && (
            <div className="mt-1 max-h-72 overflow-y-auto rounded border border-ink-100 bg-ink-50 p-2">
              <Markdown text={t.agent_output ?? ''} />
            </div>
          )}
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-1">
        {t.status === 'review' && (
          <>
            <Button size="sm" variant="primary" onClick={() => act(`/api/tasks/${t.id}/action`, { action: 'approve_draft' })}>
              {tl("Approve draft")}
            </Button>
            <Button size="sm" onClick={() => navigator.clipboard.writeText(t.agent_output ?? '')}>
              <Icon name="copy" className="h-3 w-3" /> {tl("Copy")}
            </Button>
          </>
        )}
        {t.owner_type === 'human' && ['sent', 'accepted', 'in_progress', 'blocked'].includes(t.status) && (
          <>
            <Button size="sm" variant="ghost" onClick={() => act(`/api/tasks/${t.id}/follow-up`, { kind: 'remind' })}>
              {tl("Send reminder")}
            </Button>
            {overdue && (
              <Button size="sm" variant="ghost" onClick={() => act(`/api/tasks/${t.id}/follow-up`, { kind: 'snooze' })}>
                {tl("Snooze 2 days")}
              </Button>
            )}
          </>
        )}
        {t.owner_type === 'human' && t.status !== 'done' && (
          <Button size="sm" variant="ghost" onClick={() => setReassign((r) => !r)}>
            {tl("Reassign")}
          </Button>
        )}
        {t.status !== 'done' && (
          <Button size="sm" variant="ghost" onClick={() => confirm(tl('Cancel "{title}"?', { title: t.title })) && act(`/api/tasks/${t.id}/action`, { action: 'cancel' })}>
            {tl("Cancel")}
          </Button>
        )}
      </div>
      {reassign && (
        <div className="mt-2">
          <OwnerPicker
            value={null}
            candidates={t.candidates}
            onChange={async (p) => {
              setErr(null);
              try {
                await api(`/api/tasks/${t.id}`, { method: 'PATCH', body: { directory_id: p.id } });
                setReassign(false);
                onChanged();
              } catch (e) {
                setErr((e as Error).message);
              }
            }}
          />
          <p className="mt-1 text-[11px] text-ink-400">{tl("The task goes back to “Launch plan” so you can approve the new email.")}</p>
        </div>
      )}
      {err && <p className="mt-1 text-xs text-red-700">{err}</p>}
    </div>
  );
}

export function Shell({ title, back = '/', right, children }: { title: string; back?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-ink-100 bg-white px-4 py-3">
        <Link to={back} className="inline-flex shrink-0 items-center gap-1 text-sm text-ink-600 hover:text-ink-900">
          <Icon name="chevron" className="h-4 w-4 rotate-180" /> {tl("Back")}
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h1>
        {right}
        <LanguageToggle />
      </header>
      <main className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
