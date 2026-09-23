import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Badge, Button, cx, Field, Icon, inputCls, Spinner } from '../components/ui';
import type { Department } from '../types';

const TABS = [
  { path: 'overview', label: 'Overview', admin: true },
  { path: 'users', label: 'Users', admin: true },
  { path: 'departments', label: 'Departments', admin: true },
  { path: 'prompts', label: 'Personas & prompts', admin: true },
  { path: 'models', label: 'Model routing', admin: true },
  { path: 'knowledge', label: 'Knowledge', admin: false },
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
          <Icon name="chevron" className="h-4 w-4 rotate-180" /> Back to chat
        </Link>
        <h1 className="text-sm font-semibold">{isAdmin ? 'Administration' : 'Knowledge base'}</h1>
      </header>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-ink-100 bg-white p-2 md:w-52 md:flex-col md:border-r md:border-b-0">
          {tabs.map((t) => (
            <NavLink
              key={t.path}
              to={t.path}
              className={({ isActive }) =>
                cx(
                  'rounded-lg px-3 py-2 text-sm whitespace-nowrap',
                  isActive ? 'bg-ink-900 text-white' : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900',
                )
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
        <div className="min-w-0 flex-1 overflow-y-auto p-4 md:p-6">
          <div className="mx-auto max-w-5xl">
            <Routes>
              <Route index element={<Navigate to={isAdmin ? 'overview' : 'knowledge'} replace />} />
              {isAdmin && (
                <>
                  <Route path="overview" element={<Overview />} />
                  <Route path="users" element={<Users />} />
                  <Route path="departments" element={<Departments />} />
                  <Route path="prompts" element={<Prompts />} />
                  <Route path="models" element={<Models />} />
                  <Route path="audit" element={<Audit />} />
                  <Route path="settings" element={<Settings />} />
                </>
              )}
              <Route path="knowledge" element={<Knowledge />} />
              <Route path="*" element={<Navigate to="." replace />} />
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
  return <span className="text-xs text-accent-700">Saved</span>;
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
      <Card title="System health" actions={<Button size="sm" onClick={health.reload}>Refresh</Button>}>
        {!h ? (
          <Loading error={health.error} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            <HealthItem label="Database" ok={h.db.ok} detail={h.db.error} />
            <HealthItem label="Redis / queue" ok={h.redis.ok} detail={h.redis.error} />
            <HealthItem
              label="Ollama"
              ok={h.ollama.ok && !h.ollama.detail?.missing?.length}
              detail={
                h.ollama.ok
                  ? h.ollama.detail.missing.length
                    ? `Missing models: ${h.ollama.detail.missing.join(', ')} (run: ollama pull …)`
                    : `${h.ollama.detail.url} · ${h.ollama.detail.installed.length} models`
                  : h.ollama.error
              }
            />
          </div>
        )}
      </Card>
      <Card title="Last 30 days">
        {!stats.data ? (
          <Loading error={stats.error} />
        ) : (
          <div className="grid gap-6 md:grid-cols-3">
            <div>
              <p className="mb-2 text-xs font-medium text-ink-400">Questions by department</p>
              <ul className="space-y-1 text-sm">
                {stats.data.byDepartment.map((d: any) => (
                  <li key={d.name} className="flex justify-between">
                    <span>{d.name}</span> <span className="font-medium tabular-nums">{d.questions}</span>
                  </li>
                ))}
                {!stats.data.byDepartment.length && <li className="text-ink-400">No questions yet</li>}
              </ul>
            </div>
            <div>
              <p className="mb-2 text-xs font-medium text-ink-400">Mode & latency</p>
              <ul className="space-y-1 text-sm">
                {stats.data.modes.map((m: any) => {
                  const lat = stats.data.latency.find((l: any) => l.mode === m.mode);
                  return (
                    <li key={m.mode ?? 'pending'} className="flex justify-between gap-2">
                      <span className="capitalize">{m.mode ?? 'pending'}</span>
                      <span className="tabular-nums">
                        {m.n}
                        {lat && <span className="text-ink-400"> · avg {lat.avg_seconds}s, p90 {lat.p90_seconds}s</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div>
              <p className="mb-2 text-xs font-medium text-ink-400">Feedback</p>
              <p className="text-sm">
                <span className="font-medium text-accent-700">👍 {stats.data.feedback.up}</span>
                <span className="ml-4 font-medium text-red-700">👎 {stats.data.feedback.down}</span>
              </p>
            </div>
          </div>
        )}
      </Card>
    </>
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
  const deptName = (id: string) => departments.find((d) => d.id === id)?.name ?? '—';
  return (
    <Card title="Users" actions={<Button size="sm" variant="primary" onClick={() => setAdding(true)}><Icon name="plus" className="h-3.5 w-3.5" /> Add user</Button>}>
      {adding && <UserForm onDone={() => { setAdding(false); users.reload(); }} />}
      {editing && <UserForm user={editing} onDone={() => { setEditing(null); users.reload(); }} />}
      {!users.data ? (
        <Loading error={users.error} />
      ) : (
        <div className="-mx-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-100">
                <th className={th}>Name</th>
                <th className={th}>Department</th>
                <th className={th}>Role</th>
                <th className={th}>Last login</th>
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
                      <p className="text-xs text-ink-400">+ access: {u.extra_departments.map(deptName).join(', ')}</p>
                    )}
                  </td>
                  <td className={td}>
                    <Badge tone={u.role === 'admin' ? 'blue' : 'neutral'}>{u.role.replace('_', ' ')}</Badge>
                    {!u.is_active && <Badge tone="red">inactive</Badge>}
                  </td>
                  <td className={cx(td, 'text-xs text-ink-400')}>{u.last_login_at ? new Date(u.last_login_at).toLocaleString() : 'never'}</td>
                  <td className={td}>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(u)}>Edit</Button>
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

function UserForm({ user, onDone }: { user?: any; onDone(): void }) {
  const { departments } = useAuth();
  const [f, setF] = useState({
    email: user?.email ?? '',
    display_name: user?.display_name ?? '',
    password: '',
    role: user?.role ?? 'employee',
    department_id: user?.department_id ?? departments[0]?.id ?? '',
    is_active: user?.is_active ?? true,
    extra_departments: (user?.extra_departments ?? []) as string[],
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
            ...(f.password ? { password: f.password } : {}),
          },
        });
      } else {
        await api('/api/admin/users', {
          body: { email: f.email, display_name: f.display_name, password: f.password, role: f.role, department_id: f.department_id },
        });
      }
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="mb-4 rounded-lg border border-accent-100 bg-accent-50/50 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Email">
          <input className={inputCls} value={f.email} disabled={Boolean(user)} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label="Name">
          <input className={inputCls} value={f.display_name} onChange={(e) => set('display_name', e.target.value)} />
        </Field>
        <Field label={user ? 'Reset password (optional)' : 'Initial password'} hint="At least 10 characters">
          <input className={inputCls} type="password" value={f.password} onChange={(e) => set('password', e.target.value)} />
        </Field>
        <Field label="Role">
          <select className={inputCls} value={f.role} onChange={(e) => set('role', e.target.value)}>
            <option value="employee">Employee</option>
            <option value="dept_lead">Department lead</option>
            <option value="admin">Admin</option>
          </select>
        </Field>
        <Field label="Primary department">
          <select className={inputCls} value={f.department_id} onChange={(e) => set('department_id', e.target.value)}>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </Field>
        {user && (
          <Field label="Status">
            <select className={inputCls} value={String(f.is_active)} onChange={(e) => set('is_active', e.target.value === 'true')}>
              <option value="true">Active</option>
              <option value="false">Deactivated</option>
            </select>
          </Field>
        )}
      </div>
      {user && (
        <fieldset className="mt-3">
          <legend className="mb-1 text-sm font-medium">Extra knowledge access (cross-department)</legend>
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
        <Button variant="primary" size="sm" onClick={save}>{user ? 'Save' : 'Create user'}</Button>
        <Button size="sm" onClick={onDone}>Cancel</Button>
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
    <Card title="Departments" actions={<Button size="sm" variant="primary" onClick={() => setEditing({})}><Icon name="plus" className="h-3.5 w-3.5" /> Add department</Button>}>
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
                  {d.name} <span className="text-xs font-normal text-ink-400">{d.name_ms} · {d.slug} · {d.user_count} users</span>
                </p>
                <p className="text-sm text-ink-600">{d.description}</p>
                <div className="mt-1 flex gap-1">
                  {d.review_before_acting && <Badge tone="red">Review before acting</Badge>}
                  {!d.is_active && <Badge>inactive</Badge>}
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setEditing(d)}>Edit</Button>
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
        <Field label="Slug" hint="lowercase-with-dashes; cannot change later">
          <input className={inputCls} value={f.slug} disabled={!isNew} onChange={(e) => set('slug', e.target.value)} />
        </Field>
        <Field label="Name (English)">
          <input className={inputCls} value={f.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Name (Bahasa Malaysia)">
          <input className={inputCls} value={f.name_ms} onChange={(e) => set('name_ms', e.target.value)} />
        </Field>
      </div>
      <div className="mt-3 space-y-3">
        <Field label="Description">
          <input className={inputCls} value={f.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <Field label="Department prompt layer" hint="Loaded into the Department Expert and the Chairman. Keep it short (under ~120 words); each save creates a new version.">
          <textarea className={cx(inputCls, 'h-28 font-mono text-xs')} value={f.prompt} onChange={(e) => set('prompt', e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="inline-flex items-center gap-1.5">
            <input type="checkbox" className="accent-accent-600" checked={f.review_before_acting} onChange={(e) => set('review_before_acting', e.target.checked)} />
            Flag answers "review before acting"
          </label>
          {!isNew && (
            <label className="inline-flex items-center gap-1.5">
              <input type="checkbox" className="accent-accent-600" checked={f.is_active} onChange={(e) => set('is_active', e.target.checked)} />
              Active
            </label>
          )}
        </div>
      </div>
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      <div className="mt-4 flex gap-2">
        <Button variant="primary" size="sm" onClick={save}>Save</Button>
        <Button size="sm" onClick={onDone}>Cancel</Button>
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
      <Card title="Prompt layers">
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
            Prompts are assembled at runtime from layers: <strong>base → persona → department → task</strong>. Pick a layer on
            the left to edit it. Every save creates a new version; older versions can be re-activated.
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
        <p className="mb-2 text-xs text-ink-400">{LAYER_INFO[layer]}</p>
        {persona && <PersonaFlags persona={persona} onChanged={onSaved} />}
        <textarea className={cx(inputCls, 'h-64 font-mono text-xs leading-relaxed')} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="mt-2 flex items-center justify-between">
          <span className={cx('text-xs', tokens > 300 && layer === 'persona' ? 'text-amber-700' : 'text-ink-400')}>
            ≈ {tokens} tokens{tokens > 300 && layer === 'persona' ? ' (longer than recommended for an 8B model)' : ''}
          </span>
          <Button variant="primary" size="sm" disabled={text === current?.content || !text.trim()} onClick={save}>
            Save as new version
          </Button>
        </div>
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      </Card>
      <Card title="Version history">
        <ul className="divide-y divide-ink-100 text-sm">
          {versions.map((v) => (
            <li key={v.id} className="flex items-center gap-3 py-2">
              <span className="w-10 font-medium">v{v.version}</span>
              <span className="flex-1 text-xs text-ink-400">
                {new Date(v.created_at).toLocaleString()} {v.created_by ? `· ${v.created_by}` : '· seed'}
              </span>
              {v.is_active ? (
                <Badge tone="green">active</Badge>
              ) : (
                <>
                  <Button size="sm" variant="ghost" onClick={() => setText(v.content)}>Load</Button>
                  <Button
                    size="sm"
                    onClick={async () => {
                      await api(`/api/admin/prompts/${v.id}/activate`, { method: 'POST' });
                      onSaved();
                    }}
                  >
                    Activate
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
        Sits on the council (stage 1)
      </label>
      <label className="inline-flex items-center gap-1.5">
        <input type="checkbox" className="accent-accent-600" checked={persona.is_active} onChange={(e) => patch({ is_active: e.target.checked })} />
        Active
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
      <Card title="Model per role">
        <p className="mb-3 text-xs text-ink-400">
          Keep <code>num_ctx</code> identical for every role that shares a model: Ollama reloads the model when it changes
          between requests. Router and embedding must stay on a local provider.
        </p>
        <div className="-mx-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-100">
                <th className={th}>Role</th>
                <th className={th}>Provider</th>
                <th className={th}>Model</th>
                <th className={th}>Temp</th>
                <th className={th}>num_ctx</th>
                <th className={th}>num_predict</th>
                <th className={th}>keep_alive</th>
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
      <Card title="Providers">
        <p className="mb-3 text-xs text-ink-400">
          <code>{'${OLLAMA_BASE_URL}'}</code> is read from the server's <code>.env</code>. API keys are never stored here: set the
          name of the environment variable that holds the key. Cloud providers only ever receive redacted text, and never
          content the router flags as sensitive.
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
              {p.is_cloud ? ' (cloud)' : ''}
              {!p.enabled ? ' — disabled' : ''}
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
            Save
          </Button>
        )}
        {state !== 'idle' && !dirty && <span className="text-xs text-accent-700">{state === 'saved' ? 'Saved' : ''}</span>}
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
          {p.is_cloud && <Badge tone="amber">cloud</Badge>}
        </p>
      </div>
      <input className="rounded border border-ink-200 px-2 py-1 text-sm" value={p.base_url} onChange={(e) => setP({ ...p, base_url: e.target.value })} />
      <input
        className="rounded border border-ink-200 px-2 py-1 font-mono text-xs"
        placeholder="API key env var"
        value={p.api_key_env ?? ''}
        onChange={(e) => setP({ ...p, api_key_env: e.target.value || null })}
      />
      <label className="flex items-center gap-1 text-xs" title="Parallel requests (match OLLAMA_NUM_PARALLEL)">
        slots
        <input className="w-12 rounded border border-ink-200 px-1 py-1 text-sm" type="number" min={1} value={p.max_parallel} onChange={(e) => setP({ ...p, max_parallel: Number(e.target.value) })} />
      </label>
      <div className="flex items-center gap-2">
        <label className="inline-flex items-center gap-1 text-sm">
          <input type="checkbox" className="accent-accent-600" checked={p.enabled} onChange={(e) => setP({ ...p, enabled: e.target.checked })} />
          Enabled
        </label>
        {dirty && (
          <Button
            size="sm"
            variant="primary"
            onClick={async () => {
              if (p.is_cloud && p.enabled && !provider.enabled && !confirm('Enable a cloud provider? Redacted content may leave the premises for roles routed to it.')) return;
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
            Save
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
      setMsg({ ok: true, text: `Indexed into ${r.chunks} chunks.` });
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
    ? [{ value: 'company', label: 'Company-wide (everyone)' }, ...departments.map((d: Department) => ({ value: d.id, label: `${d.name} only` }))]
    : [{ value: me!.user.department_id, label: `${me!.department.name} only` }];

  return (
    <>
      <Card title="Add a document">
        <p className="mb-3 text-xs text-ink-400">
          Staff only retrieve documents from their own department and company-wide documents (plus any extra access an admin
          grants). Phase 1 accepts .txt, .md and .csv. Requires the embedding model (<code>nomic-embed-text</code>) on Ollama.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="File">
            <input type="file" accept=".txt,.md,.markdown,.csv" className="block w-full text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>
          <Field label="Title (optional)">
            <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Defaults to file name" />
          </Field>
          <Field label="Who can retrieve it">
            <select className={inputCls} value={scope} onChange={(e) => setScope(e.target.value)}>
              {scopes.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Button variant="primary" size="sm" disabled={!file || busy} onClick={upload}>
            {busy && <Spinner className="h-3.5 w-3.5" />} Upload & index
          </Button>
          {msg && <span className={cx('text-sm', msg.ok ? 'text-accent-700' : 'text-red-700')}>{msg.text}</span>}
        </div>
      </Card>
      <Card title="Documents">
        {!docs.data ? (
          <Loading error={docs.error} />
        ) : docs.data.length === 0 ? (
          <p className="text-sm text-ink-400">No documents yet.</p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {docs.data.map((d) => (
              <li key={d.id} className="flex items-center gap-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{d.title}</p>
                  <p className="text-xs text-ink-400">
                    {d.company_wide ? 'Company-wide' : d.department_name} · {d.chunk_count} chunks · {d.uploaded_by ?? '—'} ·{' '}
                    {new Date(d.created_at).toLocaleDateString()}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={async () => {
                    if (!confirm(`Delete "${d.title}" from the knowledge base?`)) return;
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
      title="Audit log"
      actions={
        <select className="rounded border border-ink-200 px-2 py-1 text-sm" value={action} onChange={(e) => setAction(e.target.value)}>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>{a || 'All actions'}</option>
          ))}
        </select>
      }
    >
      <p className="mb-3 text-xs text-ink-400">Append-only. Rows cannot be edited or deleted except by the retention job.</p>
      <div className="-mx-4 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-ink-100">
              <th className={th}>Time</th>
              <th className={th}>Who</th>
              <th className={th}>Action</th>
              <th className={th}>Detail</th>
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
        {loading ? <Spinner /> : more && rows.length > 0 && <Button size="sm" onClick={() => load(rows[rows.length - 1].id)}>Load older</Button>}
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
    <Card title="Settings" actions={<Saved at={saved} />}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Who can use Council mode">
          <select className={inputCls} value={f.council_min_role} onChange={(e) => set('council_min_role', e.target.value)}>
            <option value="employee">All employees</option>
            <option value="dept_lead">Department leads and admins</option>
            <option value="admin">Admins only</option>
          </select>
        </Field>
        <Field label="Retention (months)" hint="Conversations and audit rows older than this are deleted nightly (PDPA).">
          <input className={inputCls} type="number" min={1} max={120} value={f.retention_months} onChange={(e) => set('retention_months', Number(e.target.value))} />
        </Field>
        <Field label="Conversation turns sent as context">
          <input className={inputCls} type="number" min={0} max={20} value={f.history_turns} onChange={(e) => set('history_turns', Number(e.target.value))} />
        </Field>
        <Field label="Knowledge snippets per answer">
          <input className={inputCls} type="number" min={1} max={20} value={f.rag_top_k} onChange={(e) => set('rag_top_k', Number(e.target.value))} />
        </Field>
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-accent-600" checked={f.rag_enabled} onChange={(e) => set('rag_enabled', e.target.checked)} />
          Use the knowledge base in answers
        </label>
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-accent-600" checked={f.peer_review_default} onChange={(e) => set('peer_review_default', e.target.checked)} />
          Peer review on by default (Auto mode)
        </label>
        <label className="inline-flex items-center gap-2 text-sm" title="Before a council run, ask the user up to 3 questions when essential details are missing">
          <input type="checkbox" className="accent-accent-600" checked={f.clarify_enabled ?? true} onChange={(e) => set('clarify_enabled', e.target.checked)} />
          Council asks clarifying questions when details are missing
        </label>
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
          Save settings
        </Button>
      </div>
    </Card>
  );
}
