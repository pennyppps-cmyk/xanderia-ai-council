import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import type { ConversationSummary } from '../types';
import { LanguageToggle } from './LanguageToggle';
import { NotificationBell } from './Notifications';
import { cx, Icon, Spinner } from './ui';
import { tl } from '../i18n';


interface Props {
  conversations: ConversationSummary[];
  query: string;
  onQuery(q: string): void;
  onChanged(): void;
  onNavigate(): void;
  /** Changes when a live notification arrives, so the bell reloads. */
  pulse?: unknown;
}

export function Sidebar({ conversations, query, onQuery, onChanged, onNavigate, pulse }: Props) {
  const { me, logout } = useAuth();
  const { id: activeId } = useParams();
  const navigate = useNavigate();
  const pinned = conversations.filter((c) => c.pinned);
  const recent = conversations.filter((c) => !c.pinned);

  return (
    <aside className="flex h-full w-72 flex-col bg-ink-950 text-ink-100">
      <div className="flex items-center gap-2 px-4 pt-4 pb-3">
        <img src="/favicon.svg" alt="" className="h-7 w-7" />
        <span className="font-semibold text-white">{tl("Xanderia AI Council")}</span>
      </div>
      <div className="space-y-2 px-3">
        <button
          onClick={() => {
            navigate('/');
            onNavigate();
          }}
          className="flex w-full items-center gap-2 rounded-lg border border-ink-800 px-3 py-2 text-sm font-medium text-white hover:bg-ink-900"
        >
          <Icon name="plus" /> {tl("New question")}
        </button>
        <div className="relative">
          <Icon name="search" className="absolute top-2.5 left-2.5 h-4 w-4 text-ink-400" />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={tl("Search history")}
            className="w-full rounded-lg bg-ink-900 py-2 pr-3 pl-8 text-sm text-white placeholder:text-ink-400 focus:ring-1 focus:ring-accent-500 focus:outline-none"
          />
        </div>
      </div>

      <nav className="mt-3 flex-1 space-y-4 overflow-y-auto px-2 pb-4">
        {pinned.length > 0 && <Group title={tl("Pinned")} items={pinned} activeId={activeId} onChanged={onChanged} onNavigate={onNavigate} />}
        <Group title={query ? tl('Results') : tl('Recent')} items={recent} activeId={activeId} onChanged={onChanged} onNavigate={onNavigate} />
        {conversations.length === 0 && (
          <p className="px-3 text-xs text-ink-400">{query ? tl('No matches.') : tl('Your conversations will appear here.')}</p>
        )}
      </nav>

      <div className="border-t border-ink-900 p-3">
        <div className="mb-2 flex items-start justify-between gap-2 px-1">
          <div className="min-w-0">
          <p className="truncate text-sm font-medium text-white">{me?.user.display_name}</p>
          <p className="truncate text-xs text-ink-400">
            {me?.department.name} · {me?.user.role.replace('_', ' ')}
          </p>
          </div>
          <LanguageToggle dark />
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <NotificationBell pulse={pulse} />
          <Link
            to="/tasks"
            onClick={onNavigate}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-200 hover:bg-ink-900 hover:text-white"
          >
            <Icon name="reply" className="h-3.5 w-3.5 -scale-x-100" /> {tl("Tasks")}
          </Link>
          <Link
            to="/decisions"
            onClick={onNavigate}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-200 hover:bg-ink-900 hover:text-white"
          >
            <Icon name="pin" className="h-3.5 w-3.5" /> {tl('Decisions')}
          </Link>
          <Link
            to="/tools"
            onClick={onNavigate}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-200 hover:bg-ink-900 hover:text-white"
          >
            <Icon name="edit" className="h-3.5 w-3.5" /> {tl('Tools')}
          </Link>
          {me && me.user.role !== 'employee' && (
            <Link
              to="/admin"
              onClick={onNavigate}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-200 hover:bg-ink-900 hover:text-white"
            >
              <Icon name="settings" className="h-3.5 w-3.5" /> {me.user.role === 'admin' ? tl('Admin') : tl('Knowledge')}
            </Link>
          )}
          <button
            onClick={async () => {
              if (!confirm(tl('Permanently delete ALL of your conversations? This cannot be undone.'))) return;
              await api('/api/conversations', { method: 'DELETE' });
              navigate('/');
              onChanged();
            }}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-200 hover:bg-ink-900 hover:text-white"
          >
            <Icon name="trash" className="h-3.5 w-3.5" /> {tl("Delete history")}
          </button>
          <button
            onClick={logout}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-200 hover:bg-ink-900 hover:text-white"
          >
            <Icon name="logout" className="h-3.5 w-3.5" /> {tl("Sign out")}
          </button>
        </div>
      </div>
    </aside>
  );
}

function Group({
  title,
  items,
  activeId,
  onChanged,
  onNavigate,
}: {
  title: string;
  items: ConversationSummary[];
  activeId?: string;
  onChanged(): void;
  onNavigate(): void;
}) {
  if (!items.length) return null;
  return (
    <div>
      <p className="px-3 pb-1 text-[11px] font-semibold tracking-wider text-ink-400 uppercase">{title}</p>
      <ul className="space-y-0.5">
        {items.map((c) => (
          <Item key={c.id} c={c} active={c.id === activeId} onChanged={onChanged} onNavigate={onNavigate} />
        ))}
      </ul>
    </div>
  );
}

function Item({ c, active, onChanged, onNavigate }: { c: ConversationSummary; active: boolean; onChanged(): void; onNavigate(): void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(c.title);
  const navigate = useNavigate();
  useEffect(() => setTitle(c.title), [c.title]);
  const running = c.last_status === 'queued' || c.last_status === 'running';

  async function save() {
    setEditing(false);
    if (title.trim() && title !== c.title) {
      await api(`/api/conversations/${c.id}`, { method: 'PATCH', body: { title: title.trim() } });
      onChanged();
    }
  }

  return (
    <li
      className={cx(
        'group flex items-center gap-1 rounded-lg pr-1 text-sm',
        active ? 'bg-ink-800 text-white' : 'text-ink-200 hover:bg-ink-900 hover:text-white',
      )}
    >
      {editing ? (
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
            if (e.key === 'Escape') setEditing(false);
          }}
          className="m-1 flex-1 rounded bg-ink-900 px-2 py-1 text-sm text-white focus:outline-none"
        />
      ) : (
        <Link to={`/c/${c.id}`} onClick={onNavigate} className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2">
          {running && <Spinner className="h-3 w-3 shrink-0 text-accent-500" />}
          <span className="truncate">{c.title}</span>
        </Link>
      )}
      {!editing && (
        <span className="hidden shrink-0 gap-0.5 group-hover:flex">
          <IconBtn title={tl("Rename")} icon="edit" onClick={() => setEditing(true)} />
          <IconBtn
            title={c.pinned ? tl('Unpin') : tl('Pin')}
            icon="pin"
            onClick={async () => {
              await api(`/api/conversations/${c.id}`, { method: 'PATCH', body: { pinned: !c.pinned } });
              onChanged();
            }}
          />
          <IconBtn
            title={tl("Delete")}
            icon="trash"
            onClick={async () => {
              if (!confirm(tl('Delete "{title}"?', { title: c.title }))) return;
              await api(`/api/conversations/${c.id}`, { method: 'DELETE' });
              if (active) navigate('/');
              onChanged();
            }}
          />
        </span>
      )}
    </li>
  );
}

function IconBtn({ icon, title, onClick }: { icon: string; title: string; onClick(): void }) {
  return (
    <button title={title} onClick={onClick} className="rounded p-1 text-ink-400 hover:bg-ink-700 hover:text-white">
      <Icon name={icon} className="h-3.5 w-3.5" />
    </button>
  );
}

