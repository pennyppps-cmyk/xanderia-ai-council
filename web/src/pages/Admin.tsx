import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Badge, Button, cx, Field, Icon, inputCls, Spinner } from '../components/ui';
import type { Department } from '../types';
import { CrewAdmin, DirectoryAdmin } from './AdminCrew';
import { HelpButton } from '../components/HelpButton';
import { LanguageToggle } from '../components/LanguageToggle';
import { tl } from '../i18n';
import CompanyMemory from './AdminMemory';
import DocumentsAdmin from './AdminDocuments';


const TABS = [
  { path: 'overview', label: 'Overview', admin: true },
  { path: 'users', label: 'Users', admin: true },
  { path: 'departments', label: 'Departments', admin: true },
  { path: 'prompts', label: 'Personas & prompts', admin: true },
  { path: 'models', label: 'Model routing', admin: true },
  { path: 'knowledge', label: 'Knowledge', admin: false },
  { path: 'directory', label: 'Staff directory', admin: true },
  { path: 'crew', label: 'Action Crew & email', admin: true },
  { path: 'memory', label: 'Company memory', admin: false },
  { path: 'documents', label: 'Documents', admin: true },
  { path: 'audit', label: 'Audit log', admin: true },
  { path: 'settings', label: 'Settings', admin: true },
];

export default function Admin() {
  const { me } = useAuth();
  const isAdmin = me?.user.role === 'admin';
  const tabs = TABS.filter((t) => isAdmin || !t.admin);
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-ink-100 bg-white px-4 py-3">
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-ink-600 hover:text-ink-900">
          <Icon name="chevron" className="h-4 w-4 rotate-180" /> {tl("Back to chat")}
        </Link>
        <h1 className="flex-1 text-sm font-semibold">{isAdmin ? tl('Administration') : tl('Knowledge base')}</h1>
        <HelpButton />
        <LanguageToggle />
      </header>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* Absolute links: inside the /admin/* splat route, relative links resolve against the full URL and pile up. */}
        <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-ink-100 bg-white p-2 md:w-52 md:flex-col md:border-r md:border-b-0">
          {tabs.map((t) => (
            <NavLink
              key={t.path}
              to={`/admin/${t.path}`}
              className={({ isActive }) =>
                cx(
                  'rounded-lg px-3 py-2 text-sm whitespace-nowrap',
                  isActive ? 'bg-ink-900 text-white' : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900',
                )
              }
            >
              {tl(t.label)}
            </NavLink>
          ))}
        </nav>
        <div className="min-w-0 flex-1 overflow-y-auto p-4 md:p-6">
          <div className="mx-auto max-w-5xl">
            <Routes>
              <Route index element={<Navigate to={isAdmin ? '/admin/overview' : '/admin/knowledge'} replace />} />
              {isAdmin && (
                <>
                  <Route path="overview" element={<Overview />} />
                  <Route path="users" element={<Users />} />
                  <Route path="departments" element={<Departments />} />
                  <Route path="prompts" element={<Prompts />} />
                  <Route path="models" element={<Models />} />
                  <Route path="audit" element={<Audit />} />
                  <Route path="settings" element={<Settings />} />
                  <Route path="directory" element={<DirectoryAdmin />} />
                  <Route path="crew" element={<CrewAdmin />} />
                  <Route path="documents" element={<DocumentsAdmin />} />
                </>
              )}
              <Route path="knowledge" element={<Knowledge />} />
              <Route path="memory" element={<CompanyMemory />} />
              <Route path="*" element={<Navigate to={isAdmin ? '/admin/overview' : '/admin/knowledge'} replace />} />
            </Routes>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────────

function useLoad<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    api<T>(path)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [path]);
  useEffect(reload, [reload]);
  return { data, error, reload };
}

function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="mb-4 rounded-xl border border-ink-100 bg-white shadow-sm">
      {title && (
        <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          {actions}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

function Loading({ error }: { error?: string | null }) {
  if (error) return <p className="text-sm text-red-700">{error}</p>;
  return <Spinner className="h-5 w-5 text-ink-400" />;
}

function Saved({ at }: { at: number | null }) {
  if (!at) return null;
  return <span className="text-xs text-accent-700">{tl("Saved")}</span>;
}

const th = 'px-3 py-2 text-left text-xs font-medium text-ink-400';
const td = 'px-3 py-2 align-top';

// ── Overview ─────────────────────────────────────────────────────────────────

function Overview() {
  const health = useLoad<any>('/api/admin/health');
  const stats = useLoad<any>('/api/admin/stats');
  const h = health.data;
  return (
    <>
      <Card title={tl("System health")} actions={<Button size="sm" onClick={health.reload}>{tl("Refresh")}</Button>}>
        {!h ? (
          <Loading error={health.error} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            <HealthItem label={tl("Database")} ok={h.db.ok} detail={h.db.error} />
            <HealthItem label={tl("Redis / queue")} ok={h.redis.ok} detail={h.redis.error} />
            <HealthItem
              label={tl("Ollama")}
              ok={h.ollama.ok && !h.ollama.detail?.missing?.length}
              detail={
                h.ollama.ok
                  ? h.ollama.detail.missing.length
                    ? tl('Missing models: {m} (run: ollama pull …)', { m: h.ollama.detail.missing.join(', ') })
                    : `${h.ollama.detail.url} · ${tl('{n} models', { n: h.ollama.detail.installed.length })}`
                  : h.ollama.error
              }
            />
          </div>
        )}
      </Card>
      <Card title={tl("Last 30 days")}>
        {!stats.data ? (
          <Loading error={stats.error} />
        ) : (
          <div className="grid gap-6 md:grid-cols-3">
            <div>
              <p className="mb-2 text-xs font-medium text-ink-400">{tl("Questions by department")}</p>
              <ul className="space-y-1 text-sm">
                {stats.data.byDepartment.map((d: any) => (
                  <li key={d.name} className="flex justify-between">
                    <span>{d.name}</span> <span className="font-medium tabular-nums">{d.questions}</span>
                  </li>
                ))}
                {!stats.data.byDepartment.length && <li className="text-ink-400">{tl("No questions yet")}</li>}
              </ul>
            </div>
            <div>
              <p className="mb-2 text-xs font-medium text-ink-400">{tl("Mode & latency")}</p>
              <ul className="space-y-1 text-sm">
                {stats.data.modes.map((m: any) => {
                  const lat = stats.data.latency.find((l: any) => l.mode === m.mode);
                  return (
                    <li key={m.mode ?? 'pending'} className="flex justify-between gap-2">
                      <span className="capitalize">{m.mode ?? 'pending'}</span>
                      <span className="tabular-nums">
                        {m.n}
                        {lat && <span className="text-ink-400"> {tl("· avg")} {lat.avg_seconds}s, p90 {lat.p90_seconds}s</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div>
              <p className="mb-2 text-xs font-medium text-ink-400">{tl("Feedback")}</p>
              <p className="text-sm">
                <span className="font-medium text-accent-700">👍 {stats.data.feedback.up}</span>
                <span className="ml-4 font-medium text-red-700">👎 {stats.data.feedback.down}</span>
              </p>
            </div>
          </div>
        )}
      </Card>
      <OrgHeatmap />
      <DigestPreview />
    </>
  );
}

/** Ask-the-org heatmap: rows = the asker's department, columns = the area the question was about. */
function OrgHeatmap() {
  const [days, setDays] = useState(90);
  const data = useLoad<{ cells: Array<{ asker: string; area: string; n: number; council: number; flags: number }>; weekly: Array<{ week: string; asker: string; n: number }> }>(
    `/api/admin/analytics/heatmap?days=${days}`,
  );
  const cells = data.data?.cells ?? [];
  const askers = [...new Set(cells.map((c) => c.asker))].sort();
  const areas = [...new Set(cells.map((c) => c.area))].sort();
  const max = Math.max(1, ...cells.map((c) => c.n));
  const at = (a: string, b: string) => cells.find((c) => c.asker === a && c.area === b);
  const weeks = [...new Set((data.data?.weekly ?? []).map((w) => w.week))];
  const wmax = Math.max(1, ...(data.data?.weekly ?? []).map((w) => w.n));
  return (
    <Card
      title={tl('Ask-the-org heatmap')}
      actions={
        <select className="rounded-lg border border-ink-200 bg-white px-2 py-1 text-xs" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label={tl('Period')}>
          {[30, 90, 180, 365].map((d) => (
            <option key={d} value={d}>{tl('Last {n} days', { n: d })}</option>
          ))}
        </select>
      }
    >
      <p className="mb-3 text-xs text-ink-500">
        {tl('Which departments ask about which areas. Heavy cells outside a department\'s own area can point to a training or policy gap. Counts only; no question content.')}
      </p>
      {!data.data ? (
        <Loading error={data.error} />
      ) : !cells.length ? (
        <p className="text-sm text-ink-400">{tl('No questions yet')}</p>
      ) : (
        <div className="space-y-6">
          <div className="overflow-x-auto">
            <table className="text-xs">
              <thead>
                <tr>
                  <th className="p-1 text-left font-medium text-ink-400">{tl('Asked by ↓ / about →')}</th>
                  {areas.map((a) => (
                    <th key={a} className="relative h-28 w-11 min-w-11 p-0 font-medium text-ink-600">
                      <span className="absolute bottom-2 left-5 origin-bottom-left -rotate-45 whitespace-nowrap">{a}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {askers.map((r) => (
                  <tr key={r}>
                    <td className="p-1 pr-3 font-medium whitespace-nowrap text-ink-700">{r}</td>
                    {areas.map((a) => {
                      const c = at(r, a);
                      const v = c ? c.n / max : 0;
                      return (
                        <td key={a} className="p-0.5">
                          <div
                            className={cx('flex h-8 w-10 items-center justify-center rounded tabular-nums', v > 0.55 ? 'text-white' : 'text-ink-700', Boolean(c?.flags) && 'ring-2 ring-red-500')}
                            style={{ background: c ? `rgba(13, 148, 136, ${0.08 + v * 0.85})` : '#f3f6f8' }}
                            title={c ? `${r} → ${a}: ${c.n} (${c.council} council${c.flags ? `, ${c.flags} red flag(s)` : ''})` : ''}
                          >
                            {c?.n ?? ''}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <p className="mb-2 text-xs font-medium text-ink-400">{tl('Questions per week')}</p>
            <div className="space-y-1">
              {askers.map((r) => (
                <div key={r} className="flex items-center gap-2 text-xs">
                  <span className="w-40 shrink-0 truncate text-ink-600">{r}</span>
                  <div className="flex h-6 items-end gap-0.5">
                    {weeks.map((w) => {
                      const n = data.data!.weekly.find((x) => x.week === w && x.asker === r)?.n ?? 0;
                      return <div key={w} className="w-2.5 rounded-sm bg-accent-600" style={{ height: `${Math.max(n ? 8 : 2, (n / wmax) * 100)}%`, opacity: n ? 1 : 0.2 }} title={`${w}: ${n}`} />;
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

/** What a department head receives on Monday morning, and a manual send. */
function DigestPreview() {
  const { departments } = useAuth();
  const [dept, setDept] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  return (
    <Card title={tl('Weekly digest')}>
      <p className="mb-3 text-xs text-ink-500">
        {tl('Every Monday at 08:00 each department head gets an email: questions asked, decisions and outcomes, overdue action tasks and knowledge due for review. Counts only, never what staff asked.')}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm" value={dept} onChange={(e) => setDept(e.target.value)} aria-label={tl('Department')}>
          <option value="">{tl('Choose a department…')}</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        <Button size="sm" disabled={!dept} onClick={async () => setPreview((await api<{ text: string }>(`/api/admin/digest/${dept}`)).text)}>
          {tl('Preview')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            if (!confirm(tl('Send this week\'s digest to every department head now?'))) return;
            const r = await api<{ queued: number }>('/api/admin/digest/send-now', { method: 'POST' });
            setSent(tl('{n} digest email(s) queued.', { n: r.queued }));
          }}
        >
          {tl('Send now')}
        </Button>
        {sent && <span className="text-xs text-accent-700">{sent}</span>}
      </div>
      {preview && <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-ink-50 p-3 text-xs whitespace-pre-wrap">{preview}</pre>}
    </Card>
  );
}

function HealthItem({ label, ok, detail }: { label: string; ok: boolean; detail?: string }) {
  return (
    <div className={cx('rounded-lg border p-3', ok ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50')}>
      <p className="text-sm font-medium">
        <span className={cx('mr-2 inline-block h-2 w-2 rounded-full', ok ? 'bg-emerald-500' : 'bg-red-500')} />
        {label}
      </p>
      {detail && <p className="mt-1 text-xs break-words text-ink-600">{detail}</p>}
    </div>
  );
}

// ── Users ────────────────────────────────────────────────────────────────────

function Users() {
  const { departments } = useAuth();
  const users = useLoad<any[]>('/api/admin/users');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [invite, setInvite] = useState<InviteResult | null>(null);
  const deptName = (id: string) => departments.find((d) => d.id === id)?.name ?? '—';
  return (
    <Card title={tl("Users")} actions={<Button size="sm" variant="primary" onClick={() => setAdding(true)}><Icon name="plus" className="h-3.5 w-3.5" /> {tl("Add user")}</Button>}>
      {invite && <InviteNotice result={invite} onClose={() => setInvite(null)} />}
      {adding && <UserForm onDone={(r) => { setAdding(false); users.reload(); if (r) setInvite(r); }} />}
      {editing && <UserForm user={editing} onDone={() => { setEditing(null); users.reload(); }} />}
      {!users.data ? (
        <Loading error={users.error} />
      ) : (
        <div className="-mx-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-100">
                <th className={th}>{tl("Name")}</th>
                <th className={th}>{tl("Department")}</th>
                <th className={th}>{tl("Role")}</th>
                <th className={th}>{tl("Last login")}</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {users.data.map((u) => (
                <tr key={u.id} className={cx(!u.is_active && 'opacity-50')}>
                  <td className={td}>
                    <p className="font-medium">{u.display_name}</p>
                    <p className="text-xs text-ink-400">{u.email}</p>
                  </td>
                  <td className={td}>
                    {deptName(u.department_id)}
                    {u.extra_departments.length > 0 && (
                      <p className="text-xs text-ink-400">{tl("+ access:")} {u.extra_departments.map(deptName).join(', ')}</p>
                    )}
                  </td>
                  <td className={td}>
                    <Badge tone={u.role === 'admin' ? 'blue' : 'neutral'}>{u.role.replace('_', ' ')}</Badge>
                    {!u.is_active && <Badge tone="red">{tl("inactive")}</Badge>}
                  </td>
                  <td className={cx(td, 'text-xs text-ink-400')}>
                    {u.last_login_at ? new Date(u.last_login_at).toLocaleString() : u.has_password ? tl('never') : <Badge tone="amber">{tl('invited')}</Badge>}
                  </td>
                  <td className={td}>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(u)}>{tl("Edit")}</Button>
                      {u.is_active && (
                        <Button
                          size="sm"
                          variant="ghost"
                          title={u.has_password ? tl('Email a password reset link') : tl('Email an invite link to set a password')}
                          onClick={async () => {
                            const r = await api<Omit<InviteResult, 'email'>>(`/api/admin/users/${u.id}/invite`, { method: 'POST' });
                            setInvite({ ...r, email: u.email });
                          }}
                        >
                          {u.has_password ? tl('Send reset link') : tl('Send invite')}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function UserForm({ user, onDone }: { user?: any; onDone(invite?: InviteResult | null): void }) {
  const { departments } = useAuth();
  const [f, setF] = useState({
    email: user?.email ?? '',
    display_name: user?.display_name ?? '',
    password: '',
    role: user?.role ?? 'employee',
    department_id: user?.department_id ?? departments[0]?.id ?? '',
    is_active: user?.is_active ?? true,
    extra_departments: (user?.extra_departments ?? []) as string[],
    weekly_digest: user?.weekly_digest ?? true,
    send_invite: true,
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v }));

  async function save() {
    setError(null);
    try {
      if (user) {
        await api(`/api/admin/users/${user.id}`, {
          method: 'PATCH',
          body: {
            display_name: f.display_name,
            role: f.role,
            department_id: f.department_id,
            is_active: f.is_active,
            extra_departments: f.extra_departments,
            weekly_digest: f.weekly_digest,
            ...(f.password ? { password: f.password } : {}),
          },
        });
      } else {
        const r = await api<{ id: string; invite: Omit<InviteResult, 'email'> | null }>('/api/admin/users', {
          body: {
            email: f.email,
            display_name: f.display_name,
            password: f.send_invite ? '' : f.password,
            send_invite: f.send_invite,
            role: f.role,
            department_id: f.department_id,
          },
        });
        onDone(r.invite ? { ...r.invite, email: f.email } : null);
        return;
      }
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="mb-4 rounded-lg border border-accent-100 bg-accent-50/50 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={tl("Email")}>
          <input className={inputCls} value={f.email} disabled={Boolean(user)} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label={tl("Name")}>
          <input className={inputCls} value={f.display_name} onChange={(e) => set('display_name', e.target.value)} />
        </Field>
        {user ? (
          <Field label={tl('Reset password (optional)')} hint={tl("At least 10 characters")}>
            <input className={inputCls} type="password" value={f.password} onChange={(e) => set('password', e.target.value)} />
          </Field>
        ) : (
          <div className="space-y-2">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1 accent-accent-600" checked={f.send_invite} onChange={(e) => set('send_invite', e.target.checked)} />
              <span>
                <span className="font-medium">{tl('Email them an invite link')}</span>
                <span className="block text-xs text-ink-400">{tl('They choose their own password from the link (valid 7 days).')}</span>
              </span>
            </label>
            {!f.send_invite && (
              <Field label={tl('Initial password')} hint={tl("At least 10 characters")}>
                <input className={inputCls} type="password" value={f.password} onChange={(e) => set('password', e.target.value)} />
              </Field>
            )}
          </div>
        )}
        <Field label={tl("Role")}>
          <select className={inputCls} value={f.role} onChange={(e) => set('role', e.target.value)}>
            <option value="employee">{tl("Employee")}</option>
            <option value="dept_lead">{tl("Department lead")}</option>
            <option value="admin">{tl("Admin")}</option>
          </select>
        </Field>
        <Field label={tl("Primary department")}>
          <select className={inputCls} value={f.department_id} onChange={(e) => set('department_id', e.target.value)}>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </Field>
        {user && (
          <Field label={tl("Status")}>
            <select className={inputCls} value={String(f.is_active)} onChange={(e) => set('is_active', e.target.value === 'true')}>
              <option value="true">{tl("Active")}</option>
              <option value="false">{tl("Deactivated")}</option>
            </select>
          </Field>
        )}
        {user && f.role === 'dept_lead' && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="accent-accent-600" checked={f.weekly_digest} onChange={(e) => set('weekly_digest', e.target.checked)} />
            {tl('Receives the weekly digest email')}
          </label>
        )}
      </div>
      {user && (
        <fieldset className="mt-3">
          <legend className="mb-1 text-sm font-medium">{tl("Extra knowledge access (cross-department)")}</legend>
          <div className="flex flex-wrap gap-3">
            {departments
              .filter((d) => d.id !== f.department_id)
              .map((d) => (
                <label key={d.id} className="inline-flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    className="accent-accent-600"
                    checked={f.extra_departments.includes(d.id)}
                    onChange={(e) =>
                      set('extra_departments', e.target.checked ? [...f.extra_departments, d.id] : f.extra_departments.filter((x) => x !== d.id))
                    }
                  />
                  {d.name}
                </label>
              ))}
          </div>
        </fieldset>
      )}
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      <div className="mt-4 flex gap-2">
        <Button variant="primary" size="sm" onClick={save}>{user ? tl('Save') : tl('Create user')}</Button>
        <Button size="sm" onClick={() => onDone()}>{tl("Cancel")}</Button>
      </div>
    </div>
  );
}

// ── Departments ──────────────────────────────────────────────────────────────

function Departments() {
  const { refresh } = useAuth();
  const list = useLoad<any[]>('/api/admin/departments');
  const [editing, setEditing] = useState<any | null>(null);
  return (
    <Card title={tl("Departments")} actions={<Button size="sm" variant="primary" onClick={() => setEditing({})}><Icon name="plus" className="h-3.5 w-3.5" /> {tl("Add department")}</Button>}>
      {editing && (
        <DepartmentForm
          dept={editing}
          onDone={() => {
            setEditing(null);
            list.reload();
            void refresh();
          }}
        />
      )}
      {!list.data ? (
        <Loading error={list.error} />
      ) : (
        <ul className="divide-y divide-ink-100">
          {list.data.map((d) => (
            <li key={d.id} className={cx('flex items-start gap-3 py-3', !d.is_active && 'opacity-50')}>
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {d.name} <span className="text-xs font-normal text-ink-400">{d.name_ms} · {d.slug} · {d.user_count} {tl("users")}</span>
                </p>
                <p className="text-sm text-ink-600">{d.description}</p>
                <div className="mt-1 flex gap-1">
                  {d.review_before_acting && <Badge tone="red">{tl("Review before acting")}</Badge>}
                  {!d.is_active && <Badge>{tl("inactive")}</Badge>}
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setEditing(d)}>{tl("Edit")}</Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function DepartmentForm({ dept, onDone }: { dept: any; onDone(): void }) {
  const isNew = !dept.id;
  const [f, setF] = useState({
    slug: dept.slug ?? '',
    name: dept.name ?? '',
    name_ms: dept.name_ms ?? '',
    description: dept.description ?? '',
    review_before_acting: dept.review_before_acting ?? false,
    is_active: dept.is_active ?? true,
    prompt: dept.prompt ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v }));
  async function save() {
    try {
      if (isNew) await api('/api/admin/departments', { body: f });
      else {
        const { slug, ...rest } = f;
        await api(`/api/admin/departments/${dept.id}`, { method: 'PATCH', body: { ...rest, prompt: f.prompt !== dept.prompt ? f.prompt : undefined } });
      }
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="mb-4 rounded-lg border border-accent-100 bg-accent-50/50 p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={tl("Slug")} hint={tl("lowercase-with-dashes; cannot change later")}>
          <input className={inputCls} value={f.slug} disabled={!isNew} onChange={(e) => set('slug', e.target.value)} />
        </Field>
        <Field label={tl("Name (English)")}>
          <input className={inputCls} value={f.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label={tl("Name (Bahasa Malaysia)")}>
          <input className={inputCls} value={f.name_ms} onChange={(e) => set('name_ms', e.target.value)} />
        </Field>
      </div>
      <div className="mt-3 space-y-3">
        <Field label={tl("Description")}>
          <input className={inputCls} value={f.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <Field label={tl("Department prompt layer")} hint={tl("Loaded into the Department Expert and the Chairman. Keep it short (under ~120 words); each save creates a new version.")}>
          <textarea className={cx(inputCls, 'h-28 font-mono text-xs')} value={f.prompt} onChange={(e) => set('prompt', e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="inline-flex items-center gap-1.5">
            <input type="checkbox" className="accent-accent-600" checked={f.review_before_acting} onChange={(e) => set('review_before_acting', e.target.checked)} />
            {tl("Flag answers \"review before acting\"")}
          </label>
          {!isNew && (
            <label className="inline-flex items-center gap-1.5">
              <input type="checkbox" className="accent-accent-600" checked={f.is_active} onChange={(e) => set('is_active', e.target.checked)} />
              {tl("Active")}
            </label>
          )}
        </div>
      </div>
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      <div className="mt-4 flex gap-2">
        <Button variant="primary" size="sm" onClick={save}>{tl("Save")}</Button>
        <Button size="sm" onClick={onDone}>{tl("Cancel")}</Button>
      </div>
    </div>
  );
}

// ── Prompts ──────────────────────────────────────────────────────────────────

const LAYER_INFO: Record<string, string> = {
  base: 'Shared by every advisor. Company context, regulation, language, and the rule that user/document text is data.',
  persona: "Each advisor's mandate. Keep to 150–300 tokens: Hermes 3 8B follows short, specific personas best.",
  department: 'Edited under Departments.',
  task: 'Output format per step: router, quick answer, council advisor, peer review, chairman.',
};

function Prompts() {
  const data = useLoad<{ personas: any[]; components: any[] }>('/api/admin/prompts');
  const [selected, setSelected] = useState<{ layer: string; key: string } | null>(null);
  if (!data.data) return <Loading error={data.error} />;
  const { personas, components } = data.data;
  const active = components.filter((c) => c.is_active && c.layer !== 'department');
  const versions = selected ? components.filter((c) => c.layer === selected.layer && c.key === selected.key) : [];

  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
      <Card title={tl("Prompt layers")}>
        {(['base', 'persona', 'task'] as const).map((layer) => (
          <div key={layer} className="mb-3">
            <p className="mb-1 text-xs font-semibold tracking-wide text-ink-400 uppercase">{layer}</p>
            <ul>
              {active
                .filter((c) => c.layer === layer)
                .map((c) => {
                  const persona = personas.find((p) => p.key === c.key);
                  return (
                    <li key={c.id}>
                      <button
                        onClick={() => setSelected({ layer: c.layer, key: c.key })}
                        className={cx(
                          'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm',
                          selected?.layer === c.layer && selected?.key === c.key ? 'bg-ink-900 text-white' : 'hover:bg-ink-100',
                        )}
                      >
                        <span className="truncate">{persona?.name ?? c.key}</span>
                        <span className="text-xs opacity-60">v{c.version}</span>
                      </button>
                    </li>
                  );
                })}
            </ul>
          </div>
        ))}
      </Card>
      {selected ? (
        <PromptEditor
          key={`${selected.layer}:${selected.key}`}
          layer={selected.layer}
          promptKey={selected.key}
          versions={versions}
          persona={personas.find((p) => p.key === selected.key)}
          onSaved={data.reload}
        />
      ) : (
        <Card>
          <p className="text-sm text-ink-600">
            {tl("Prompts are assembled at runtime from layers:")} <strong>{tl("base → persona → department → task")}</strong>{tl(". Pick a layer on the left to edit it. Every save creates a new version; older versions can be re-activated.")}
          </p>
        </Card>
      )}
    </div>
  );
}

function PromptEditor({ layer, promptKey, versions, persona, onSaved }: { layer: string; promptKey: string; versions: any[]; persona?: any; onSaved(): void }) {
  const current = versions.find((v) => v.is_active) ?? versions[0];
  const [text, setText] = useState(current?.content ?? '');
  const [saved, setSaved] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tokens = Math.ceil(text.length / 3.8);

  async function save() {
    setError(null);
    try {
      await api('/api/admin/prompts', { body: { layer, key: promptKey, content: text } });
      setSaved(Date.now());
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div>
      <Card title={`${persona?.name ?? promptKey} · ${layer}`} actions={<Saved at={saved} />}>
        <p className="mb-2 text-xs text-ink-400">{tl(LAYER_INFO[layer])}</p>
        {persona && <PersonaFlags persona={persona} onChanged={onSaved} />}
        <textarea className={cx(inputCls, 'h-64 font-mono text-xs leading-relaxed')} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="mt-2 flex items-center justify-between">
          <span className={cx('text-xs', tokens > 300 && layer === 'persona' ? 'text-amber-700' : 'text-ink-400')}>
            ≈ {tokens} {tl("tokens")}{tokens > 300 && layer === 'persona' ? ` (${tl('longer than recommended for an 8B model')})` : ''}
          </span>
          <Button variant="primary" size="sm" disabled={text === current?.content || !text.trim()} onClick={save}>
            {tl("Save as new version")}
          </Button>
        </div>
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      </Card>
      <PromptSandbox layer={layer} promptKey={promptKey} content={text} />
      <Card title={tl("Version history")}>
        <ul className="divide-y divide-ink-100 text-sm">
          {versions.map((v) => (
            <li key={v.id} className="flex items-center gap-3 py-2">
              <span className="w-10 font-medium">v{v.version}</span>
              <span className="flex-1 text-xs text-ink-400">
                {new Date(v.created_at).toLocaleString()} {v.created_by ? `· ${v.created_by}` : `· ${tl('seed')}`}
              </span>
              {v.is_active ? (
                <Badge tone="green">{tl("active")}</Badge>
              ) : (
                <>
                  <Button size="sm" variant="ghost" onClick={() => setText(v.content)}>{tl("Load")}</Button>
                  <Button
                    size="sm"
                    onClick={async () => {
                      await api(`/api/admin/prompts/${v.id}/activate`, { method: 'POST' });
                      onSaved();
                    }}
                  >
                    {tl("Activate")}
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function PersonaFlags({ persona, onChanged }: { persona: any; onChanged(): void }) {
  async function patch(body: object) {
    await api(`/api/admin/personas/${persona.key}`, { method: 'PATCH', body });
    onChanged();
  }
  if (persona.key === 'chairman') return null;
  return (
    <div className="mb-3 flex flex-wrap gap-4 text-sm">
      <label className="inline-flex items-center gap-1.5">
        <input type="checkbox" className="accent-accent-600" checked={persona.in_council} onChange={(e) => patch({ in_council: e.target.checked })} />
        {tl("Sits on the council (stage 1)")}
      </label>
      <label className="inline-flex items-center gap-1.5">
        <input type="checkbox" className="accent-accent-600" checked={persona.is_active} onChange={(e) => patch({ is_active: e.target.checked })} />
        {tl("Active")}
      </label>
    </div>
  );
}

// ── Models ───────────────────────────────────────────────────────────────────

function Models() {
  const data = useLoad<{ roles: any[]; providers: any[] }>('/api/admin/models');
  if (!data.data) return <Loading error={data.error} />;
  return (
    <>
      <Card title={tl("Model per role")}>
        <p className="mb-3 text-xs text-ink-400">
          {tl("Keep")} <code>num_ctx</code> {tl("identical for every role that shares a model: Ollama reloads the model when it changes between requests. Router and embedding must stay on a local provider.")}
        </p>
        <div className="-mx-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-100">
                <th className={th}>{tl("Role")}</th>
                <th className={th}>{tl("Provider")}</th>
                <th className={th}>{tl("Model")}</th>
                <th className={th}>{tl("Temp")}</th>
                <th className={th}>{tl("num_ctx")}</th>
                <th className={th}>{tl("num_predict")}</th>
                <th className={th}>{tl("keep_alive")}</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {data.data.roles.map((r) => (
                <RoleRow key={r.role} role={r} providers={data.data!.providers} onSaved={data.reload} />
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title={tl("Providers")}>
        <p className="mb-3 text-xs text-ink-400">
          <code>{'${OLLAMA_BASE_URL}'}</code> {tl("is read from the server's")} <code>.env</code>{tl(". API keys are never stored here: set the name of the environment variable that holds the key. Cloud providers only ever receive redacted text, and never content the router flags as sensitive.")}
        </p>
        <ul className="divide-y divide-ink-100">
          {data.data.providers.map((p) => (
            <ProviderRow key={p.id} provider={p} onSaved={data.reload} />
          ))}
        </ul>
      </Card>
    </>
  );
}

function RoleRow({ role, providers, onSaved }: { role: any; providers: any[]; onSaved(): void }) {
  const [r, setR] = useState(role);
  const [state, setState] = useState<'idle' | 'saved' | string>('idle');
  const dirty = JSON.stringify(r) !== JSON.stringify(role);
  const set = (k: string, v: any) => setR((x: any) => ({ ...x, [k]: v }));
  const num = 'w-20 rounded border border-ink-200 px-2 py-1 text-sm';
  return (
    <tr>
      <td className={cx(td, 'font-mono text-xs whitespace-nowrap')}>{r.role}</td>
      <td className={td}>
        <select className="rounded border border-ink-200 px-2 py-1 text-sm" value={r.provider_id} onChange={(e) => set('provider_id', e.target.value)}>
          {providers.map((p) => (
            <option key={p.id} value={p.id} disabled={!p.enabled}>
              {p.id}
              {p.is_cloud ? ` (${tl('cloud')})` : ''}
              {!p.enabled ? ` — ${tl('disabled')}` : ''}
            </option>
          ))}
        </select>
      </td>
      <td className={td}>
        <input className="w-36 rounded border border-ink-200 px-2 py-1 text-sm" value={r.model} onChange={(e) => set('model', e.target.value)} />
      </td>
      <td className={td}>
        <input className={num} type="number" step="0.1" min="0" max="2" value={r.temperature} onChange={(e) => set('temperature', Number(e.target.value))} />
      </td>
      <td className={td}>
        <input className={num} type="number" value={r.num_ctx} onChange={(e) => set('num_ctx', Number(e.target.value))} />
      </td>
      <td className={td}>
        <input className={num} type="number" value={r.num_predict} onChange={(e) => set('num_predict', Number(e.target.value))} />
      </td>
      <td className={td}>
        <input className="w-16 rounded border border-ink-200 px-2 py-1 text-sm" value={r.keep_alive} onChange={(e) => set('keep_alive', e.target.value)} />
      </td>
      <td className={cx(td, 'whitespace-nowrap')}>
        {dirty && (
          <Button
            size="sm"
            variant="primary"
            onClick={async () => {
              try {
                const { role: name, updated_at, ...body } = r;
                await api(`/api/admin/models/${name}`, { method: 'PATCH', body });
                setState('saved');
                onSaved();
              } catch (e) {
                setState((e as Error).message);
              }
            }}
          >
            {tl("Save")}
          </Button>
        )}
        {state !== 'idle' && !dirty && <span className="text-xs text-accent-700">{state === 'saved' ? tl('Saved') : ''}</span>}
        {state !== 'idle' && state !== 'saved' && <p className="text-xs text-red-700">{state}</p>}
      </td>
    </tr>
  );
}

function ProviderRow({ provider, onSaved }: { provider: any; onSaved(): void }) {
  const [p, setP] = useState(provider);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(p) !== JSON.stringify(provider);
  return (
    <li className="grid gap-2 py-3 sm:grid-cols-[8rem_1fr_9rem_6rem_auto] sm:items-center">
      <div>
        <p className="font-mono text-sm">{p.id}</p>
        <p className="text-xs text-ink-400">
          {p.kind}
          {p.is_cloud && <Badge tone="amber">{tl("cloud")}</Badge>}
        </p>
      </div>
      <input className="rounded border border-ink-200 px-2 py-1 text-sm" value={p.base_url} onChange={(e) => setP({ ...p, base_url: e.target.value })} />
      <input
        className="rounded border border-ink-200 px-2 py-1 font-mono text-xs"
        placeholder={tl("API key env var")}
        value={p.api_key_env ?? ''}
        onChange={(e) => setP({ ...p, api_key_env: e.target.value || null })}
      />
      <label className="flex items-center gap-1 text-xs" title={tl("Parallel requests (match OLLAMA_NUM_PARALLEL)")}>
        {tl("slots")}
        <input className="w-12 rounded border border-ink-200 px-1 py-1 text-sm" type="number" min={1} value={p.max_parallel} onChange={(e) => setP({ ...p, max_parallel: Number(e.target.value) })} />
      </label>
      <div className="flex items-center gap-2">
        <label className="inline-flex items-center gap-1 text-sm">
          <input type="checkbox" className="accent-accent-600" checked={p.enabled} onChange={(e) => setP({ ...p, enabled: e.target.checked })} />
          {tl("Enabled")}
        </label>
        {dirty && (
          <Button
            size="sm"
            variant="primary"
            onClick={async () => {
              if (p.is_cloud && p.enabled && !provider.enabled && !confirm(tl('Enable a cloud provider? Redacted content may leave the premises for roles routed to it.'))) return;
              try {
                await api(`/api/admin/providers/${p.id}`, {
                  method: 'PATCH',
                  body: { base_url: p.base_url, api_key_env: p.api_key_env, enabled: p.enabled, max_parallel: p.max_parallel },
                });
                onSaved();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            {tl("Save")}
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-red-700 sm:col-span-5">{error}</p>}
    </li>
  );
}

// ── Knowledge ────────────────────────────────────────────────────────────────

function Knowledge() {
  const { me, departments } = useAuth();
  const isAdmin = me?.user.role === 'admin';
  const docs = useLoad<any[]>('/api/knowledge/documents');
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [scope, setScope] = useState(isAdmin ? 'company' : me!.user.department_id);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function upload() {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    const form = new FormData();
    if (title) form.append('title', title);
    form.append('companyWide', String(scope === 'company'));
    if (scope !== 'company') form.append('departmentId', scope);
    form.append('file', file);
    try {
      const r = await api('/api/knowledge/documents', { form });
      setMsg({ ok: true, text: tl('Indexed into {n} chunks.', { n: r.chunks }) });
      setFile(null);
      setTitle('');
      docs.reload();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const scopes: Array<{ value: string; label: string }> = isAdmin
    ? [{ value: 'company', label: tl('Company-wide (everyone)') }, ...departments.map((d: Department) => ({ value: d.id, label: tl('{name} only', { name: d.name }) }))]
    : [{ value: me!.user.department_id, label: tl('{name} only', { name: me!.department.name }) }];

  return (
    <>
      <Card title={tl("Add a document")}>
        <p className="mb-3 text-xs text-ink-400">
          {tl("Staff only retrieve documents from their own department and company-wide documents (plus any extra access an admin grants). Accepts PDF (text PDFs, not scans), Word (.docx), Excel (.xlsx), .txt, .md, .csv, and a .zip of Markdown notes (for example an Obsidian vault). Answers cite the document and page / section / sheet. Requires the embedding model (")}<code>nomic-embed-text</code>{tl(") on Ollama.")}
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={tl("File")}>
            <input type="file" accept=".pdf,.docx,.xlsx,.txt,.md,.markdown,.csv,.zip" className="block w-full text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>
          <Field label={tl("Title (optional)")}>
            <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={tl("Defaults to file name")} />
          </Field>
          <Field label={tl("Who can retrieve it")}>
            <select className={inputCls} value={scope} onChange={(e) => setScope(e.target.value)}>
              {scopes.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Button variant="primary" size="sm" disabled={!file || busy} onClick={upload}>
            {busy && <Spinner className="h-3.5 w-3.5" />} {tl("Upload & index")}
          </Button>
          {msg && <span className={cx('text-sm', msg.ok ? 'text-accent-700' : 'text-red-700')}>{msg.text}</span>}
        </div>
      </Card>
      <Card title={tl("Documents")}>
        {!docs.data ? (
          <Loading error={docs.error} />
        ) : docs.data.length === 0 ? (
          <p className="text-sm text-ink-400">{tl("No documents yet.")}</p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {docs.data.map((d) => (
              <li key={d.id} className="flex items-center gap-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {d.title} {d.stale && <Badge tone="amber">{tl('Review due')}</Badge>}
                  </p>
                  <p className="text-xs text-ink-400">
                    {d.company_wide ? tl('Company-wide') : d.department_name} · {d.chunk_count} {tl("chunks ·")} {d.uploaded_by ?? '—'} ·{' '}
                    {new Date(d.created_at).toLocaleDateString()} ·{' '}
                    {d.reviewed_at
                      ? tl('reviewed {date} by {who}', { date: new Date(d.reviewed_at).toLocaleDateString(), who: d.reviewed_by ?? '—' })
                      : tl('not reviewed yet')}{' '}
                    · {tl('next review {date}', { date: new Date(d.review_due).toLocaleDateString() })}
                  </p>
                </div>
                <select
                  className="rounded-lg border border-ink-200 bg-white px-2 py-1 text-xs"
                  value={d.review_after_days}
                  aria-label={tl('Review every')}
                  title={tl('Review every')}
                  onChange={async (e) => {
                    await api(`/api/knowledge/documents/${d.id}/review`, { body: { reviewAfterDays: Number(e.target.value) } });
                    docs.reload();
                  }}
                >
                  {[...new Set([30, 90, 180, 365, d.review_after_days])].sort((a, b) => a - b).map((n) => (
                    <option key={n} value={n}>{tl('every {n} days', { n })}</option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant={d.stale ? 'primary' : 'ghost'}
                  title={tl('Confirm this document is still current')}
                  onClick={async () => {
                    await api(`/api/knowledge/documents/${d.id}/review`, { body: {} });
                    docs.reload();
                  }}
                >
                  {tl('Mark reviewed')}
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={async () => {
                    if (!confirm(tl('Delete "{title}" from the knowledge base?', { title: d.title }))) return;
                    await api(`/api/knowledge/documents/${d.id}`, { method: 'DELETE' });
                    docs.reload();
                  }}
                >
                  <Icon name="trash" className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

// ── Audit ────────────────────────────────────────────────────────────────────

const ACTIONS = ['', 'model_call', 'question_asked', 'rag_retrieval', 'login', 'login_failed', 'document_uploaded', 'prompt_saved', 'model_role_updated', 'user_updated', 'history_deleted', 'retention_run'];

function Audit() {
  const [action, setAction] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [more, setMore] = useState(true);

  const load = useCallback(
    async (before?: number) => {
      setLoading(true);
      const q = new URLSearchParams({ limit: '100' });
      if (action) q.set('action', action);
      if (before) q.set('before', String(before));
      const page = await api<any[]>(`/api/admin/audit?${q}`);
      setRows((r) => (before ? [...r, ...page] : page));
      setMore(page.length === 100);
      setLoading(false);
    },
    [action],
  );
  useEffect(() => void load(), [load]);

  return (
    <Card
      title={tl("Audit log")}
      actions={
        <select className="rounded border border-ink-200 px-2 py-1 text-sm" value={action} onChange={(e) => setAction(e.target.value)}>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>{a || tl('All actions')}</option>
          ))}
        </select>
      }
    >
      <p className="mb-3 text-xs text-ink-400">{tl("Append-only. Rows cannot be edited or deleted except by the retention job.")}</p>
      <div className="-mx-4 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-ink-100">
              <th className={th}>{tl("Time")}</th>
              <th className={th}>{tl("Who")}</th>
              <th className={th}>{tl("Action")}</th>
              <th className={th}>{tl("Detail")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className={cx(td, 'whitespace-nowrap text-ink-400')}>{new Date(r.at).toLocaleString()}</td>
                <td className={cx(td, 'whitespace-nowrap')}>{r.actor_email ?? (r.actor_user_id ? r.actor_user_id.slice(0, 8) : 'system')}</td>
                <td className={td}>
                  <Badge tone={r.action === 'model_call' ? (r.detail.is_cloud ? 'amber' : 'green') : r.action.includes('failed') ? 'red' : 'neutral'}>{r.action}</Badge>
                </td>
                <td className={cx(td, 'font-mono text-[11px] break-all text-ink-600')}>{summarise(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3">
        {loading ? <Spinner /> : more && rows.length > 0 && <Button size="sm" onClick={() => load(rows[rows.length - 1].id)}>{tl("Load older")}</Button>}
      </div>
    </Card>
  );
}

function summarise(r: any) {
  const d = r.detail ?? {};
  if (r.action === 'model_call') {
    const bits = [d.purpose ?? d.role, `${d.provider}/${d.model}`, d.latency_ms != null && `${d.latency_ms}ms`];
    if (d.completion_tokens) bits.push(`${d.prompt_tokens}→${d.completion_tokens} tok`);
    if (d.forced_local) bits.push('forced local');
    if (d.redactions && Object.keys(d.redactions).length) bits.push(`redacted ${JSON.stringify(d.redactions)}`);
    if (!d.ok) bits.push(`ERROR ${d.error}`);
    return bits.filter(Boolean).join(' · ');
  }
  if (r.action === 'question_asked') return `${d.requested_mode} · ${d.length} chars · message ${String(r.target_id).slice(0, 8)} · sha256 ${String(d.sha256).slice(0, 12)}…`;
  if (r.action === 'rag_retrieval') return `${d.chunks} chunks from ${d.documents?.length} document(s)`;
  return JSON.stringify(d);
}

// ── Settings ─────────────────────────────────────────────────────────────────

function Settings() {
  const data = useLoad<Record<string, any>>('/api/admin/settings');
  const { refresh } = useAuth();
  const [f, setF] = useState<Record<string, any> | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  useEffect(() => {
    if (data.data) setF(data.data);
  }, [data.data]);
  if (!f) return <Loading error={data.error} />;
  const set = (k: string, v: any) => setF((x) => ({ ...x!, [k]: v }));
  return (
    <Card title={tl("Settings")} actions={<Saved at={saved} />}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={tl("Who can use Council mode")}>
          <select className={inputCls} value={f.council_min_role} onChange={(e) => set('council_min_role', e.target.value)}>
            <option value="employee">{tl("All employees")}</option>
            <option value="dept_lead">{tl("Department leads and admins")}</option>
            <option value="admin">{tl("Admins only")}</option>
          </select>
        </Field>
        <Field label={tl("Retention (months)")} hint={tl("Conversations and audit rows older than this are deleted nightly (PDPA).")}>
          <input className={inputCls} type="number" min={1} max={120} value={f.retention_months} onChange={(e) => set('retention_months', Number(e.target.value))} />
        </Field>
        <Field label={tl("Conversation turns sent as context")}>
          <input className={inputCls} type="number" min={0} max={20} value={f.history_turns} onChange={(e) => set('history_turns', Number(e.target.value))} />
        </Field>
        <Field label={tl("Knowledge snippets per answer")}>
          <input className={inputCls} type="number" min={1} max={20} value={f.rag_top_k} onChange={(e) => set('rag_top_k', Number(e.target.value))} />
        </Field>
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-accent-600" checked={f.rag_enabled} onChange={(e) => set('rag_enabled', e.target.checked)} />
          {tl("Use the knowledge base in answers")}
        </label>
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-accent-600" checked={f.peer_review_default} onChange={(e) => set('peer_review_default', e.target.checked)} />
          {tl("Peer review on by default (Auto mode)")}
        </label>
        <label className="inline-flex items-center gap-2 text-sm" title={tl("Before a council run, ask the user up to 3 questions when essential details are missing")}>
          <input type="checkbox" className="accent-accent-600" checked={f.clarify_enabled ?? true} onChange={(e) => set('clarify_enabled', e.target.checked)} />
          {tl("Council asks clarifying questions when details are missing")}
        </label>
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-accent-600" checked={f.weekly_digest_enabled ?? true} onChange={(e) => set('weekly_digest_enabled', e.target.checked)} />
          {tl("Send department heads a weekly digest email")}
        </label>
      </div>
      <h3 className="mt-6 mb-2 text-sm font-semibold">{tl('Loan tools')}</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={tl('NPL definition (days past due)')} hint={tl('Used by the portfolio report.')}>
          <input className={inputCls} type="number" min={30} max={360} value={f.portfolio_npl_days ?? 90} onChange={(e) => set('portfolio_npl_days', Number(e.target.value))} />
        </Field>
        <label className="inline-flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" className="accent-accent-600" checked={f.portfolio_restructured_is_npl ?? true} onChange={(e) => set('portfolio_restructured_is_npl', e.target.checked)} />
          {tl('Count restructured / rescheduled loans as NPL')}
        </label>
        <Field label={tl('Portfolio report recipients (Management)')} hint={tl('Email addresses, separated by commas.')}>
          <input
            className={inputCls}
            value={(f.portfolio_report_recipients ?? []).join(', ')}
            onChange={(e) => set('portfolio_report_recipients', e.target.value.split(/[,;\s]+/).map((x: string) => x.trim()).filter(Boolean))}
          />
        </Field>
        <Field label={tl('Affordability: maximum deductions (% of gross pay)')} hint={tl('Including the new instalment. 60% is the usual limit for salary deductions.')}>
          <input className={inputCls} type="number" min={10} max={100} value={f.affordability_max_deduction_pct ?? 60} onChange={(e) => set('affordability_max_deduction_pct', Number(e.target.value))} />
        </Field>
        <Field label={tl('Affordability: minimum net pay after the instalment (RM)')} hint={tl('0 = no minimum.')}>
          <input className={inputCls} type="number" min={0} value={f.affordability_min_net ?? 0} onChange={(e) => set('affordability_min_net', Number(e.target.value))} />
        </Field>
        <Field label={tl('Notis blast: column Finance uses to hold a customer')} hint={tl('Rows with anything written in this column are not sent.')}>
          <input className={inputCls} value={f.notis_hold_column ?? 'remarks Ain'} onChange={(e) => set('notis_hold_column', e.target.value)} />
        </Field>
        <Field label={tl('Notis blast: remove customer details after (days)')} hint={tl('IC, address and amounts are deleted from old batches; the send log is kept.')}>
          <input className={inputCls} type="number" min={7} max={3650} value={f.notis_retention_days ?? 90} onChange={(e) => set('notis_retention_days', Number(e.target.value))} />
        </Field>
      </div>
      <h3 className="mt-6 mb-2 text-sm font-semibold">{tl('Work automation')}</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="inline-flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 accent-accent-600" checked={f.weekly_plan_enabled ?? false} onChange={(e) => set('weekly_plan_enabled', e.target.checked)} />
          <span>
            {tl('Monday email: each person gets their week of tasks, most urgent first')}
            <span className="block text-xs text-ink-400">{tl('Monday 8:00, only to people with open tasks.')}</span>
          </span>
        </label>
        <label className="inline-flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 accent-accent-600" checked={f.weekly_checkin_enabled ?? false} onChange={(e) => set('weekly_checkin_enabled', e.target.checked)} />
          <span>
            {tl('Friday check-in: one click per task (done / on track / stuck)')}
            <span className="block text-xs text-ink-400">{tl('Friday 3:00 pm, only about tasks due soon or late.')}</span>
          </span>
        </label>
        <Field label={tl('Overloaded at (open tasks)')} hint={tl('Plans warn and suggest a colleague when an owner has this many open tasks...')}>
          <input className={inputCls} type="number" min={1} max={100} value={f.crew_overload?.open ?? 8} onChange={(e) => set('crew_overload', { ...(f.crew_overload ?? { overdue: 3 }), open: Number(e.target.value) })} />
        </Field>
        <Field label={tl('...or this many overdue tasks')}>
          <input className={inputCls} type="number" min={1} max={100} value={f.crew_overload?.overdue ?? 3} onChange={(e) => set('crew_overload', { ...(f.crew_overload ?? { open: 8 }), overdue: Number(e.target.value) })} />
        </Field>
      </div>
      <h3 className="mt-6 mb-2 text-sm font-semibold">{tl('Portfolio limits')}</h3>
      <label className="mb-3 inline-flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="accent-accent-600"
          checked={f.portfolio_alerts?.enabled ?? false}
          onChange={(e) => set('portfolio_alerts', { npl_ratio_max: 5, par30_max: 15, branch_npl_max: 8, ...f.portfolio_alerts, enabled: e.target.checked })}
        />
        {tl('When a saved month breaks a limit, the council meets on it automatically and proposes a plan')}
      </label>
      <div className="grid gap-4 sm:grid-cols-3">
        {(
          [
            ['npl_ratio_max', 'NPL ratio above (%)', 5],
            ['par30_max', 'PAR30 above (%)', 15],
            ['branch_npl_max', "A branch's NPL ratio above (%)", 8],
          ] as const
        ).map(([k, label, dflt]) => (
          <Field key={k} label={tl(label)}>
            <input
              className={inputCls}
              type="number"
              min={0}
              max={100}
              step="0.1"
              value={f.portfolio_alerts?.[k] ?? dflt}
              onChange={(e) => set('portfolio_alerts', { enabled: false, npl_ratio_max: 5, par30_max: 15, branch_npl_max: 8, ...f.portfolio_alerts, [k]: Number(e.target.value) })}
            />
          </Field>
        ))}
      </div>
      <div className="mt-4">
        <Button
          variant="primary"
          size="sm"
          onClick={async () => {
            const { local_fallback, ...body } = f;
            await api('/api/admin/settings', { method: 'PATCH', body });
            setSaved(Date.now());
            void refresh();
          }}
        >
          {tl("Save settings")}
        </Button>
      </div>
    </Card>
  );
}


// ── "Test this prompt" sandbox ───────────────────────────────────────────────

function PromptSandbox({ layer, promptKey, content }: { layer: string; promptKey: string; content: string }) {
  const { departments } = useAuth();
  const [question, setQuestion] = useState('');
  const [dept, setDept] = useState(layer === 'department' ? promptKey : 'credit-collections');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSystem, setShowSystem] = useState(false);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api('/api/admin/prompts/test', { body: { layer, key: promptKey, content, question, department: dept } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={tl("Test this prompt")}>
      <p className="mb-2 text-xs text-ink-400">
        {tl("Runs the text above (saved or not) the way the real step uses it: same layers, same model and settings, same JSON schema. Nothing is saved or shown to staff.")}
      </p>
      <div className="flex flex-wrap gap-2">
        <textarea
          className={cx(inputCls, 'min-w-0 flex-1')}
          rows={2}
          placeholder={tl("A sample question, e.g. Should we move reminder SMS from day 5 to day 2?")}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <div className="flex flex-col gap-2">
          <select className="rounded-lg border border-ink-200 px-2 py-1.5 text-sm" value={dept} onChange={(e) => setDept(e.target.value)} disabled={layer === 'department'}>
            {departments.map((d) => (
              <option key={d.slug} value={d.slug}>
                {d.name}
              </option>
            ))}
          </select>
          <Button size="sm" variant="primary" disabled={!question.trim() || !content.trim() || busy} onClick={run}>
            {busy && <Spinner className="h-3.5 w-3.5" />} {tl("Run test")}
          </Button>
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      {result && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-400">
            <Badge>{result.role}</Badge>
            {result.model && <Badge>{result.model}</Badge>}
            {result.latencyMs != null && <Badge>{(result.latencyMs / 1000).toFixed(1)} s</Badge>}
            {result.structured && (
              <Badge tone={result.structured.valid ? 'green' : 'red'}>
                {result.structured.valid ? tl('valid JSON (attempt {n})', { n: result.structured.attempts }) : tl('failed schema: {e}', { e: result.structured.error })}
              </Badge>
            )}
            <button className="ml-auto text-accent-700 hover:underline" onClick={() => setShowSystem((s) => !s)}>
              {showSystem ? tl('Hide') : tl('Show')} {tl("full system prompt")}
            </button>
          </div>
          {showSystem && <pre className="max-h-60 overflow-y-auto rounded-lg bg-ink-50 p-3 text-xs whitespace-pre-wrap">{result.system}</pre>}
          <pre className="max-h-96 overflow-y-auto rounded-lg border border-ink-100 bg-white p-3 text-sm whitespace-pre-wrap">{result.output}</pre>
        </div>
      )}
    </Card>
  );
}


// ── Invite / reset link result ───────────────────────────────────────────────

interface InviteResult {
  email: string;
  link: string;
  emailed: boolean;
  blocked: boolean;
}

function InviteNotice({ result, onClose }: { result: InviteResult; onClose(): void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={cx('mb-4 rounded-lg border p-3 text-sm', result.emailed ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50')}>
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium">
          {result.emailed
            ? tl('Link emailed to {email}.', { email: result.email })
            : result.blocked
              ? tl("{email} is outside the allowed email domains, so nothing was emailed. Send them this link yourself:", { email: result.email })
              : tl("Email isn't connected yet (record-only outbox), so nothing was sent. Send {email} this link yourself:", { email: result.email })}
        </p>
        <button onClick={onClose} className="text-xs text-ink-400 hover:text-ink-900">
          {tl('Dismiss')}
        </button>
      </div>
      {!result.emailed && (
        <div className="mt-2 flex gap-2">
          <input readOnly value={result.link} className={cx(inputCls, 'font-mono text-xs')} onFocus={(e) => e.target.select()} />
          <Button
            size="sm"
            onClick={async () => {
              await navigator.clipboard.writeText(result.link);
              setCopied(true);
            }}
          >
            {copied ? tl('Copied') : tl('Copy')}
          </Button>
        </div>
      )}
      <p className="mt-1 text-xs text-ink-600">{tl('The link works once. Invites expire after 7 days, reset links after 1 hour.')}</p>
    </div>
  );
}
