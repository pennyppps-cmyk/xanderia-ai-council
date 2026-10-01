import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { OwnerPicker } from '../components/OwnerPicker';
import { Badge, Button, cx, Field, FilePicker, Icon, inputCls, Spinner } from '../components/ui';
import { getLang, tl } from '../i18n';
import type { Person } from '../types';
import { Shell } from './Plan';

interface Action {
  task: string;
  owner: string;
  directory_id: string | null;
  due_date: string;
}
interface Minutes {
  summary: string;
  decisions: string[];
  actions: Action[];
  open_points: string[];
}
interface Meeting {
  id: string;
  title: string;
  held_on: string;
  language: 'en' | 'ms';
  attendees: string[];
  attendee_list: Array<{ id: string; name: string; position: string }>;
  notes: string;
  minutes: Minutes | null;
  status: 'draft' | 'writing' | 'minuted' | 'error';
  error: string | null;
  plan_id: string | null;
  voice: boolean;
}

const today = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

/** Meetings → minutes → tracked tasks. */
export default function MeetingsPage() {
  const { id } = useParams();
  return id ? <MeetingView id={id} /> : <MeetingList />;
}

function MeetingList() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Array<{ id: string; title: string; held_on: string; status: string; plan_id: string | null; actions: number; created_by_name: string }> | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => void api<typeof rows>('/api/meetings').then(setRows).catch(() => setRows([])), []);
  return (
    <Shell
      title={tl('Meetings')}
      right={
        <Button
          size="sm"
          variant="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const r = await api<{ id: string }>('/api/meetings', { body: { title: tl('New meeting'), held_on: today(), language: getLang() } });
            navigate(`/meetings/${r.id}`);
          }}
        >
          <Icon name="plus" className="h-3.5 w-3.5" /> {tl('New meeting')}
        </Button>
      }
    >
      <p className="mb-4 max-w-3xl text-sm text-ink-600">
        {tl('Paste your meeting notes or upload a recording. The council writes the minutes and picks out every action item with its owner and due date; after you check them, they become tracked tasks.')}
      </p>
      {!rows ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-ink-200 bg-white p-6 text-center text-sm text-ink-500">{tl('No meetings yet.')}</p>
      ) : (
        <ul className="divide-y divide-ink-100 rounded-xl border border-ink-100 bg-white">
          {rows.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
              <Link to={`/meetings/${m.id}`} className="flex-1 font-medium text-accent-700 hover:underline">
                {m.title}
              </Link>
              <span className="text-xs text-ink-500">{m.held_on}</span>
              {m.status === 'minuted' && <Badge tone="green">{tl('{n} actions', { n: m.actions })}</Badge>}
              {m.status === 'writing' && <Badge tone="blue">{tl('Writing minutes')}</Badge>}
              {m.plan_id && <Badge tone="blue">{tl('Tasks created')}</Badge>}
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}

function MeetingView({ id }: { id: string }) {
  const navigate = useNavigate();
  const [m, setM] = useState<Meeting | null>(null);
  const [owners, setOwners] = useState<Record<number, Person | null>>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audio, setAudio] = useState<File | null>(null);
  const [addPerson, setAddPerson] = useState(false);

  const load = useCallback(async () => {
    const d = await api<Meeting>(`/api/meetings/${id}`);
    setM(d);
    setDirty(false);
    // Owners of the action items, for the pickers.
    const ids = [...new Set((d.minutes?.actions ?? []).map((a) => a.directory_id).filter(Boolean))] as string[];
    if (ids.length) {
      const people = await api<Array<{ id: string; name: string; position: string }>>(`/api/crew/workload?ids=${ids.join(',')}`);
      setOwners(Object.fromEntries((d.minutes?.actions ?? []).map((a, i) => [i, people.find((p) => p.id === a.directory_id) ? { ...people.find((p) => p.id === a.directory_id)!, email: '' } : null])));
    } else setOwners({});
  }, [id]);
  useEffect(() => void load().catch((e) => setError((e as Error).message)), [load]);
  useEffect(() => {
    if (m?.status !== 'writing') return;
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [m?.status, load]);

  if (!m) return <Shell title={tl('Meeting')} back="/meetings">{error ? <p className="text-sm text-red-700">{error}</p> : <Spinner />}</Shell>;

  const set = (patch: Partial<Meeting>) => {
    setM({ ...m, ...patch });
    setDirty(true);
  };
  const setMin = (patch: Partial<Minutes>) => set({ minutes: { ...m.minutes!, ...patch } });
  const body = () => ({ title: m.title, held_on: m.held_on, language: m.language, attendees: m.attendees, notes: m.notes, minutes: m.minutes });

  async function act(name: string, fn: () => Promise<void>) {
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
  const save = () => api(`/api/meetings/${id}`, { method: 'PUT', body: body() }).then(() => setDirty(false));

  const list = (key: 'decisions' | 'open_points', label: string) => (
    <Field label={label}>
      <textarea
        className={cx(inputCls, 'min-h-20 text-sm')}
        value={m.minutes![key].join('\n')}
        onChange={(e) => setMin({ [key]: e.target.value.split('\n').filter((x, i, a) => x.trim() || i < a.length - 1) } as Partial<Minutes>)}
        placeholder={tl('One per line')}
      />
    </Field>
  );

  return (
    <Shell title={m.title} back="/meetings">
      <div className="mx-auto max-w-5xl space-y-4">
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <section className="rounded-xl border border-ink-100 bg-white p-4 shadow-sm">
          <div className="grid gap-3 md:grid-cols-[1fr_10rem_10rem]">
            <Field label={tl('Meeting')}>
              <input className={inputCls} value={m.title} maxLength={200} onChange={(e) => set({ title: e.target.value })} />
            </Field>
            <Field label={tl('Date')}>
              <input type="date" className={inputCls} value={m.held_on} onChange={(e) => set({ held_on: e.target.value })} />
            </Field>
            <Field label={tl('Minutes in')}>
              <select className={inputCls} value={m.language} onChange={(e) => set({ language: e.target.value as 'en' | 'ms' })}>
                <option value="en">English</option>
                <option value="ms">Bahasa Malaysia</option>
              </select>
            </Field>
          </div>
          <div className="mt-3">
            <p className="mb-1 text-sm font-medium">{tl('Attendees')}</p>
            <div className="flex flex-wrap items-center gap-1">
              {m.attendee_list.map((p) => (
                <span key={p.id} className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2 py-0.5 text-xs">
                  {p.name}
                  <button className="text-ink-400 hover:text-red-600" aria-label={tl('Remove')} onClick={() => set({ attendees: m.attendees.filter((x) => x !== p.id), attendee_list: m.attendee_list.filter((x) => x.id !== p.id) })}>
                    ×
                  </button>
                </span>
              ))}
              {addPerson ? (
                <span className="w-64">
                  <OwnerPicker
                    value={null}
                    candidates={[]}
                    onChange={(p) => {
                      if (!m.attendees.includes(p.id)) set({ attendees: [...m.attendees, p.id], attendee_list: [...m.attendee_list, { id: p.id, name: p.name, position: p.position }] });
                      setAddPerson(false);
                    }}
                  />
                </span>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setAddPerson(true)}>
                  <Icon name="plus" className="h-3.5 w-3.5" /> {tl('Add')}
                </Button>
              )}
            </div>
            <p className="mt-1 text-xs text-ink-400">{tl('Action items are matched to the attendees first ("Aina will…" means the Aina in the room).')}</p>
          </div>
          <Field label={tl('Notes or transcript')}>
            <textarea className={cx(inputCls, 'min-h-48 text-sm')} maxLength={60000} value={m.notes} onChange={(e) => set({ notes: e.target.value })} placeholder={tl('Paste or type the meeting notes. Rough notes are fine.')} />
          </Field>
          {m.voice && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <div className="w-72">
                <FilePicker compact accept={['.mp3', '.m4a', '.wav', '.webm', '.ogg', '.mp4']} file={audio} onChange={setAudio} />
              </div>
              <Button
                size="sm"
                disabled={!audio || busy !== null}
                onClick={() =>
                  act('transcribe', async () => {
                    const form = new FormData();
                    form.append('lang', m.language);
                    form.append('file', audio!);
                    const r = await api<{ text: string }>('/api/meetings/transcribe', { form });
                    set({ notes: (m.notes ? `${m.notes}\n\n` : '') + r.text });
                    setAudio(null);
                  })
                }
              >
                {busy === 'transcribe' && <Spinner />} {tl('Transcribe the recording')}
              </Button>
              <span className="text-xs text-ink-400">{tl('Transcribed on our own server; the recording is not kept.')}</span>
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button disabled={!dirty || busy !== null} onClick={() => act('save', save)}>
              {tl('Save')}
            </Button>
            <Button
              variant="primary"
              disabled={busy !== null || m.status === 'writing' || m.notes.trim().length < 40}
              onClick={() =>
                act('minutes', async () => {
                  if (m.minutes && !confirm(tl('Write the minutes again from the notes? Your edits to the minutes will be replaced.'))) return;
                  await save();
                  await api(`/api/meetings/${id}/minutes`, { method: 'POST' });
                  await load();
                })
              }
            >
              {m.status === 'writing' ? <Spinner /> : <Icon name="spark" className="h-4 w-4" />} {m.status === 'writing' ? tl('Writing the minutes…') : tl('Write the minutes')}
            </Button>
          </div>
          {m.status === 'error' && <p className="mt-2 text-sm text-red-700">{m.error}</p>}
        </section>

        {m.minutes && m.status !== 'writing' && (
          <section className="space-y-3 rounded-xl border border-ink-100 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="flex-1 text-sm font-semibold">{tl('Minutes')}</h2>
              <a href={`/api/meetings/${id}/minutes.docx`} className="inline-flex items-center gap-1 text-sm font-medium text-accent-700 hover:underline">
                <Icon name="download" className="h-4 w-4" /> {tl('Minutes on the letterhead (Word)')}
              </a>
            </div>
            <Field label={tl('Summary')}>
              <textarea className={cx(inputCls, 'min-h-20 text-sm')} value={m.minutes.summary} onChange={(e) => setMin({ summary: e.target.value })} />
            </Field>
            {list('decisions', tl('Decisions'))}
            <div>
              <p className="mb-1 text-sm font-medium">{tl('Action items')}</p>
              <ol className="space-y-2">
                {m.minutes.actions.map((a, i) => (
                  <li key={i} className="grid gap-2 rounded-lg border border-ink-100 bg-ink-50 p-2 md:grid-cols-[1fr_16rem_9rem_2rem]">
                    <input className={cx(inputCls, 'py-1 text-sm')} value={a.task} onChange={(e) => setMin({ actions: m.minutes!.actions.map((x, j) => (j === i ? { ...x, task: e.target.value } : x)) })} />
                    <div>
                      <OwnerPicker
                        value={owners[i] ?? null}
                        candidates={m.attendee_list.map((p) => ({ ...p, email: '' }))}
                        onChange={(p) => {
                          setOwners({ ...owners, [i]: p });
                          setMin({ actions: m.minutes!.actions.map((x, j) => (j === i ? { ...x, directory_id: p.id } : x)) });
                        }}
                      />
                      {!a.directory_id && a.owner && <p className="mt-0.5 text-xs text-amber-700">{tl('Said: "{name}". Choose who.', { name: a.owner })}</p>}
                    </div>
                    <input type="date" className={cx(inputCls, 'py-1 text-sm')} value={a.due_date} onChange={(e) => setMin({ actions: m.minutes!.actions.map((x, j) => (j === i ? { ...x, due_date: e.target.value } : x)) })} />
                    <Button size="sm" variant="ghost" title={tl('Remove')} onClick={() => setMin({ actions: m.minutes!.actions.filter((_, j) => j !== i) })}>
                      <Icon name="trash" className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ol>
              <Button size="sm" variant="ghost" className="mt-1" onClick={() => setMin({ actions: [...m.minutes!.actions, { task: '', owner: '', directory_id: null, due_date: today() }] })}>
                <Icon name="plus" className="h-3.5 w-3.5" /> {tl('Add action')}
              </Button>
            </div>
            {list('open_points', tl('Open points'))}
            <div className="flex flex-wrap items-center gap-2 border-t border-ink-100 pt-3">
              <Button disabled={!dirty || busy !== null} onClick={() => act('save', save)}>
                {tl('Save minutes')}
              </Button>
              {m.plan_id ? (
                <Link to={`/plans/${m.plan_id}`} className="text-sm font-medium text-accent-700 hover:underline">
                  {tl('Open the tasks from this meeting')}
                </Link>
              ) : (
                <Button
                  variant="primary"
                  disabled={busy !== null || !m.minutes.actions.length}
                  onClick={() =>
                    act('tasks', async () => {
                      await save();
                      const r = await api<{ planId: string }>(`/api/meetings/${id}/tasks`, { method: 'POST' });
                      navigate(`/plans/${r.planId}`);
                    })
                  }
                >
                  <Icon name="send" className="h-4 w-4" /> {tl('Turn action items into tasks')}
                </Button>
              )}
            </div>
          </section>
        )}

        <Button
          variant="danger"
          size="sm"
          onClick={() => confirm(tl('Delete this meeting?')) && act('delete', async () => { await api(`/api/meetings/${id}`, { method: 'DELETE' }); navigate('/meetings'); })}
        >
          <Icon name="trash" className="h-3.5 w-3.5" /> {tl('Delete meeting')}
        </Button>
      </div>
    </Shell>
  );
}
