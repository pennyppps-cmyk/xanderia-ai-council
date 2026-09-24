import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Badge, Button, cx, Field, inputCls, Spinner } from '../components/ui';
import { tl } from '../i18n';

function Card({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-4 rounded-xl border border-ink-100 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-ink-100 px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {actions}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

// ── Staff directory ──────────────────────────────────────────────────────────

interface DirRow {
  id: string;
  name: string;
  position: string;
  email: string;
  department_id: string | null;
  department_name: string | null;
  manager_email: string | null;
  is_active: boolean;
}

export function DirectoryAdmin() {
  const { departments } = useAuth();
  const [rows, setRows] = useState<DirRow[] | null>(null);
  const [editing, setEditing] = useState<Partial<DirRow> | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [filter, setFilter] = useState('');
  const load = useCallback(() => {
    api<DirRow[]>('/api/admin/directory').then(setRows).catch((e) => setMsg({ ok: false, text: e.message }));
  }, []);
  useEffect(load, [load]);

  async function importCsv(file: File) {
    setMsg(null);
    try {
      const r = await api<{ imported: number; skipped: string[] }>('/api/admin/directory/import', { body: { csv: await file.text() } });
      setMsg({ ok: true, text: tl('Imported {n} people', { n: r.imported }) + (r.skipped.length ? `; ${tl('skipped {n} row(s) with missing name, position or email', { n: r.skipped.length })}` : '') + '.' });
      load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }

  async function save() {
    if (!editing) return;
    setMsg(null);
    try {
      const body = {
        name: editing.name,
        position: editing.position,
        email: editing.email,
        department_id: editing.department_id || null,
        manager_email: editing.manager_email ?? '',
        ...(editing.id ? { is_active: editing.is_active } : {}),
      };
      if (editing.id) await api(`/api/admin/directory/${editing.id}`, { method: 'PATCH', body });
      else await api('/api/admin/directory', { body });
      setEditing(null);
      load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }

  const shown = (rows ?? []).filter((r) => !filter || `${r.name} ${r.position} ${r.email} ${r.department_name}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <Card
      title={`${tl('Staff directory')}${rows ? ` (${tl('{n} active', { n: rows.filter((r) => r.is_active).length })})` : ''}`}
      actions={
        <div className="flex gap-2">
          <label className="inline-flex cursor-pointer items-center rounded-lg border border-ink-200 px-2.5 py-1 text-xs font-medium hover:bg-ink-50">
            {tl("Import CSV")}
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} />
          </label>
          <Button size="sm" variant="primary" onClick={() => setEditing({ is_active: true })}>
            {tl("Add person")}
          </Button>
        </div>
      }
    >
      <p className="mb-3 text-xs text-ink-400">
        {tl("The Action Crew only assigns tasks and sends emails to people in this directory. CSV columns (from an HR export):")}{' '}
        <code>name, position, department, email, manager_email</code>{tl(". Re-importing updates people by email.")}
      </p>
      {msg && <p className={cx('mb-3 rounded-lg px-3 py-2 text-sm', msg.ok ? 'bg-accent-50 text-accent-700' : 'bg-red-50 text-red-700')}>{msg.text}</p>}
      {editing && (
        <div className="mb-4 grid gap-3 rounded-lg border border-accent-100 bg-accent-50/50 p-4 sm:grid-cols-3">
          <Field label={tl("Name")}>
            <input className={inputCls} value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          </Field>
          <Field label={tl("Position")}>
            <input className={inputCls} value={editing.position ?? ''} onChange={(e) => setEditing({ ...editing, position: e.target.value })} />
          </Field>
          <Field label={tl("Work email")}>
            <input className={inputCls} value={editing.email ?? ''} onChange={(e) => setEditing({ ...editing, email: e.target.value })} />
          </Field>
          <Field label={tl("Department")}>
            <select className={inputCls} value={editing.department_id ?? ''} onChange={(e) => setEditing({ ...editing, department_id: e.target.value || null })}>
              <option value="">—</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={tl("Manager's email")} hint={tl("Used only for escalations the requester approves")}>
            <input className={inputCls} value={editing.manager_email ?? ''} onChange={(e) => setEditing({ ...editing, manager_email: e.target.value })} />
          </Field>
          {editing.id && (
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input type="checkbox" className="accent-accent-600" checked={editing.is_active ?? true} onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })} />
              {tl("Active")}
            </label>
          )}
          <div className="flex gap-2 sm:col-span-3">
            <Button size="sm" variant="primary" onClick={save}>
              {tl("Save")}
            </Button>
            <Button size="sm" onClick={() => setEditing(null)}>
              {tl("Cancel")}
            </Button>
          </div>
        </div>
      )}
      <input className={cx(inputCls, 'mb-3')} placeholder={tl("Filter")} value={filter} onChange={(e) => setFilter(e.target.value)} />
      {!rows ? (
        <Spinner className="h-5 w-5 text-ink-400" />
      ) : (
        <div className="-mx-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-100 text-left text-xs text-ink-400">
                <th className="px-3 py-2 font-medium">{tl("Name")}</th>
                <th className="px-3 py-2 font-medium">{tl("Position")}</th>
                <th className="px-3 py-2 font-medium">{tl("Department")}</th>
                <th className="px-3 py-2 font-medium">{tl("Manager")}</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {shown.map((r) => (
                <tr key={r.id} className={cx(!r.is_active && 'opacity-50')}>
                  <td className="px-3 py-2">
                    <p className="font-medium">{r.name}</p>
                    <p className="text-xs text-ink-400">{r.email}</p>
                  </td>
                  <td className="px-3 py-2">{r.position}</td>
                  <td className="px-3 py-2 text-ink-600">{r.department_name ?? '—'}</td>
                  <td className="px-3 py-2 text-xs text-ink-600">{r.manager_email ?? '—'}</td>
                  <td className="px-3 py-2">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>
                      {tl("Edit")}
                    </Button>
                  </td>
                </tr>
              ))}
              {!shown.length && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-sm text-ink-400">
                    {tl("No one yet. Import the HR export or add people one by one.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ── Crew settings, holidays, outbox ──────────────────────────────────────────

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function CrewAdmin() {
  const [s, setS] = useState<Record<string, any> | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [holidays, setHolidays] = useState<Array<{ date: string; name: string }>>([]);
  const [newHoliday, setNewHoliday] = useState({ date: '', name: '' });
  const [outbox, setOutbox] = useState<{ provider: string; emails: any[] } | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(() => {
    api('/api/admin/settings').then(setS);
    api<Array<{ date: string; name: string }>>('/api/admin/holidays').then(setHolidays);
    api<{ provider: string; emails: any[] }>('/api/admin/outbox').then(setOutbox);
  }, []);
  useEffect(load, [load]);

  if (!s) return <Spinner className="h-5 w-5 text-ink-400" />;
  const set = (k: string, v: unknown) => setS({ ...s, [k]: v });
  const timings = s.crew_timings ?? {};
  const names = s.crew_names ?? {};

  async function save() {
    setSaved(null);
    try {
      await api('/api/admin/settings', {
        method: 'PATCH',
        body: {
          crew_names: names,
          crew_email_domains: s!.crew_email_domains,
          crew_business_hours: s!.crew_business_hours,
          crew_weekend: s!.crew_weekend,
          crew_timings: timings,
        },
      });
      setSaved(tl('Saved'));
    } catch (e) {
      setSaved((e as Error).message);
    }
  }

  return (
    <>
      <Card title={tl("Action Crew")} actions={saved && <span className="text-xs text-accent-700">{saved}</span>}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={tl("Agent names")} hint={tl("Shown in the crew panel")}>
            <div className="grid grid-cols-2 gap-2">
              {(['dispatcher', 'herald', 'tracker', 'runner'] as const).map((k) => (
                <input key={k} className={inputCls} value={names[k] ?? ''} onChange={(e) => set('crew_names', { ...names, [k]: e.target.value })} />
              ))}
            </div>
          </Field>
          <Field label={tl("Allowed email domains")} hint={tl("Comma-separated. Emails to any other domain are blocked.")}>
            <input
              className={inputCls}
              value={(s.crew_email_domains ?? []).join(', ')}
              onChange={(e) => set('crew_email_domains', e.target.value.split(',').map((x) => x.trim()).filter(Boolean))}
            />
          </Field>
          <Field label={tl("Business hours (KL time)")} hint={tl("No emails are sent outside these hours")}>
            <div className="flex items-center gap-2">
              <input type="number" min={0} max={23} className={inputCls} value={s.crew_business_hours?.start ?? 9} onChange={(e) => set('crew_business_hours', { ...s.crew_business_hours, start: Number(e.target.value) })} />
              <span className="text-ink-400">{tl("to")}</span>
              <input type="number" min={1} max={24} className={inputCls} value={s.crew_business_hours?.end ?? 18} onChange={(e) => set('crew_business_hours', { ...s.crew_business_hours, end: Number(e.target.value) })} />
            </div>
          </Field>
          <Field label={tl("Weekend")} hint={tl("Kedah, Kelantan and Terengganu use Fri + Sat")}>
            <div className="flex flex-wrap gap-2">
              {DAYS.map((d, i) => (
                <label key={d} className="inline-flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    className="accent-accent-600"
                    checked={(s.crew_weekend ?? [0, 6]).includes(i)}
                    onChange={(e) => set('crew_weekend', e.target.checked ? [...(s.crew_weekend ?? []), i] : (s.crew_weekend ?? []).filter((x: number) => x !== i))}
                  />
                  {tl(d)}
                </label>
              ))}
            </div>
          </Field>
          <Field label={tl("Reminder if not acknowledged after (working days)")}>
            <input type="number" min={1} className={inputCls} value={timings.ackReminderDays ?? 1} onChange={(e) => set('crew_timings', { ...timings, ackReminderDays: Number(e.target.value) })} />
          </Field>
          <Field label={tl("Reminder before the due date (working days)")}>
            <input type="number" min={0} className={inputCls} value={timings.dueReminderDaysBefore ?? 1} onChange={(e) => set('crew_timings', { ...timings, dueReminderDaysBefore: Number(e.target.value) })} />
          </Field>
          <Field label={tl("Propose manager escalation after overdue (working days)")}>
            <input type="number" min={1} className={inputCls} value={timings.escalateAfterDays ?? 3} onChange={(e) => set('crew_timings', { ...timings, escalateAfterDays: Number(e.target.value) })} />
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" className="accent-accent-600" checked={timings.escalationEnabled ?? true} onChange={(e) => set('crew_timings', { ...timings, escalationEnabled: e.target.checked })} />
            {tl("Allow manager escalation (always needs the requester's approval)")}
          </label>
        </div>
        <div className="mt-4">
          <Button size="sm" variant="primary" onClick={save}>
            {tl("Save crew settings")}
          </Button>
        </div>
      </Card>

      <Card title={tl("Public holidays")}>
        <p className="mb-3 text-xs text-ink-400">{tl("No emails are sent, and no working days are counted, on these dates. Add national and state holidays (Hari Raya, CNY, Deepavali…) each year.")}</p>
        <div className="mb-3 flex flex-wrap gap-2">
          <input type="date" className={cx(inputCls, 'w-44')} value={newHoliday.date} onChange={(e) => setNewHoliday({ ...newHoliday, date: e.target.value })} />
          <input className={cx(inputCls, 'w-64')} placeholder={tl("Name, e.g. Hari Kebangsaan")} value={newHoliday.name} onChange={(e) => setNewHoliday({ ...newHoliday, name: e.target.value })} />
          <Button
            size="sm"
            disabled={!newHoliday.date || !newHoliday.name}
            onClick={async () => {
              await api('/api/admin/holidays', { body: newHoliday });
              setNewHoliday({ date: '', name: '' });
              load();
            }}
          >
            {tl("Add")}
          </Button>
        </div>
        <ul className="divide-y divide-ink-100 text-sm">
          {holidays.map((h) => (
            <li key={h.date} className="flex items-center justify-between py-1.5">
              <span>
                <span className="font-mono text-xs text-ink-400">{h.date}</span> {h.name}
              </span>
              <Button size="sm" variant="ghost" onClick={async () => (await api(`/api/admin/holidays/${h.date}`, { method: 'DELETE' }), load())}>
                {tl("Remove")}
              </Button>
            </li>
          ))}
          {!holidays.length && <li className="py-2 text-xs text-ink-400">{tl("No holidays configured.")}</li>}
        </ul>
      </Card>

      <Card
        title={tl("Email outbox")}
        actions={
          outbox && (
            <Badge tone={outbox.provider === 'outbox' ? 'amber' : 'green'}>
              {outbox.provider === 'outbox' ? tl('Record-only: emails are not sent') : tl('Sending via {p}', { p: outbox.provider })}
            </Badge>
          )
        }
      >
        {outbox?.provider === 'outbox' && (
          <p className="mb-3 text-xs text-ink-400">
            {tl("To send real email, set")} <code>MAIL_PROVIDER=smtp</code> {tl("(with SMTP_HOST, SMTP_USER, SMTP_PASS) or")} <code>MAIL_PROVIDER=n8n</code> {tl("(with N8N_MAIL_WEBHOOK_URL) in .env and restart.")}
          </p>
        )}
        <ul className="divide-y divide-ink-100 text-sm">
          {outbox?.emails.map((e) => (
            <li key={e.id} className="py-2">
              <button className="flex w-full items-center gap-2 text-left" onClick={() => setOpen(open === e.id ? null : e.id)}>
                <Badge tone={e.status === 'sent' ? 'green' : e.status === 'logged' ? 'blue' : e.status === 'queued' ? 'amber' : 'red'}>{e.status}</Badge>
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{e.subject}</span> <span className="text-ink-400">→ {e.to_email}</span>
                </span>
                <span className="shrink-0 text-xs text-ink-400">{new Date(e.created_at).toLocaleString()}</span>
              </button>
              {open === e.id && (
                <pre className="mt-2 rounded-lg bg-ink-50 p-3 text-xs whitespace-pre-wrap text-ink-700">
                  {e.body_text}
                  {e.error ? `\n\n[${e.error}]` : ''}
                </pre>
              )}
            </li>
          ))}
          {outbox && !outbox.emails.length && <li className="py-2 text-xs text-ink-400">{tl("No emails yet.")}</li>}
        </ul>
      </Card>
    </>
  );
}
