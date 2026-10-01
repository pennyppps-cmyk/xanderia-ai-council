import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { Badge, Button, cx, Field, FilePicker, Icon, inputCls, Spinner } from '../components/ui';
import { tl } from '../i18n';
import { Shell } from './Plan';

/**
 * Templates workspace: a Word document with {{tags}}, each tag mapped once to a column of the
 * uploaded data; every row becomes a document, an Outlook draft or an email.
 */
type Format = string;
interface TagMap { source: 'column' | 'text' | 'run_date'; column?: string; text?: string; format?: Format }
interface Filter { column: string; op: string; value?: string }
interface EmailSettings { toColumn?: string; subject?: string; body?: string }
interface Meta { formats: Record<string, string>; ops: Record<string, string>; pdf: boolean; directSending: boolean }
interface TemplateListItem { id: string; name: string; description: string; file_name: string; tags: string[]; shared: boolean; updated_at: string; department: string | null; owner: string | null; last_run: string | null }
interface Template {
  id: string;
  name: string;
  description: string;
  file_name: string;
  tags: string[];
  mapping: Record<string, TagMap>;
  filters: Filter[];
  email: EmailSettings;
  filename_pattern: string;
  sheet: string | null;
  shared: boolean;
  canEdit: boolean;
  runs: Array<{ id: string; source_file: string; created_at: string; purged_at: string | null; by: string | null; rows: number }>;
}
interface RunRow { id: string; row_no: number; excluded: boolean; delivery: string | null; delivery_error: string | null; values: Record<string, string>; blank: string[]; passes: boolean; email: string | null }
interface Run { run: { id: string; source_file: string; sheet: string | null; headers: string[]; run_date: string; purged_at: string | null }; rows: RunRow[] }

async function download(path: string, fallback: string) {
  const res = await fetch(path, { credentials: 'same-origin' });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `Download failed (${res.status})`);
  const raw = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1];
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await res.blob());
  a.download = raw ? decodeURIComponent(raw) : fallback;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

async function upload<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(path, { method: 'POST', body: form, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? 'Upload failed'), { sheets: data.sheets as string[] | undefined });
  return data as T;
}

const card = 'rounded-xl border border-ink-100 bg-white p-4 shadow-sm md:p-5';
const Err = ({ e }: { e: string | null }) => (e ? <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{e}</p> : null);

export default function TemplatesPage() {
  const { id } = useParams();
  return <Shell title={tl('Document templates')} back={id ? '/templates' : '/'}>{id ? <TemplateView id={id} /> : <TemplateList />}</Shell>;
}

function TemplateList() {
  const navigate = useNavigate();
  const [list, setList] = useState<TemplateListItem[] | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => void api<TemplateListItem[]>('/api/merge/templates').then(setList).catch(() => setList([])), []);
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <section className={card}>
        <h2 className="text-base font-semibold">{tl('New template')}</h2>
        <p className="mt-1 text-xs text-ink-500">
          {tl('In Word, type {{tags}} where the data goes, for example {{customername}}, {{amount}}, {{date}}, and save as .docx. You can also add tags afterwards by selecting text in the preview. Each tag is then matched to a column of your spreadsheet once; every row becomes a document.')}
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Field label={tl('Word template (.docx)')}>
            <FilePicker accept={['.docx']} file={file} onChange={setFile} />
          </Field>
          <Field label={tl('Name')}>
            <input className={inputCls} value={name} placeholder={tl('e.g. Payment reminder')} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <Button
          className="mt-3"
          variant="primary"
          disabled={!file || busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const form = new FormData();
              form.append('name', name);
              form.append('file', file!);
              const r = await upload<{ id: string }>('/api/merge/templates', form);
              navigate(`/templates/${r.id}`);
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Spinner /> : <Icon name="plus" className="h-4 w-4" />} {tl('Upload template')}
        </Button>
        <Err e={error} />
      </section>
      <section className={card}>
        <h2 className="text-base font-semibold">{tl('Your templates')}</h2>
        {!list ? (
          <Spinner />
        ) : list.length === 0 ? (
          <p className="mt-2 text-sm text-ink-500">{tl('No templates yet.')}</p>
        ) : (
          <ul className="mt-2 divide-y divide-ink-100">
            {list.map((t) => (
              <li key={t.id}>
                <Link to={`/templates/${t.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5 hover:bg-ink-50">
                  <span>
                    <span className="font-medium">{t.name}</span>
                    <span className="ml-2 text-xs text-ink-500">
                      {t.file_name} · {t.owner} · {t.department}
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-1.5">
                    <Badge>{tl('{n} tags', { n: t.tags.length })}</Badge>
                    {t.shared && <Badge tone="blue">{tl('Company-wide')}</Badge>}
                    {t.last_run && <Badge tone="green">{tl('Last used {d}', { d: new Date(t.last_run).toLocaleDateString() })}</Badge>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

type Tab = 'data' | 'template' | 'email' | 'generate';

function TemplateView({ id }: { id: string }) {
  const navigate = useNavigate();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [t, setT] = useState<Template | null>(null);
  const [draft, setDraft] = useState<Template | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [tab, setTab] = useState<Tab>('data');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const loadRun = async (runId: string) => setRun(await api<Run>(`/api/merge/runs/${runId}`));
  const load = async (keepRun?: string) => {
    const tpl = await api<Template>(`/api/merge/templates/${id}`);
    setT(tpl);
    setDraft(tpl);
    const runId = keepRun ?? tpl.runs.find((r) => !r.purged_at)?.id;
    if (runId) await loadRun(runId);
    else setRun(null);
  };
  useEffect(() => {
    void api<Meta>('/api/merge/meta').then(setMeta);
    load().catch((e) => setError(e.message));
  }, [id]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(t), [draft, t]);
  if (error && !t) return <Err e={error} />;
  if (!t || !draft || !meta) return <Spinner />;

  const run$ = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    setNote(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const save = () =>
    run$('save', async () => {
      await api(`/api/merge/templates/${id}`, {
        method: 'PUT',
        body: { name: draft.name, description: draft.description, mapping: draft.mapping, filters: draft.filters, email: draft.email, filename_pattern: draft.filename_pattern, shared: draft.shared },
      });
      await load(run?.run.id);
      setNote(tl('Saved.'));
    });
  const headers = run?.run.headers ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <section className={card}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {t.canEdit ? (
              <input className="w-full rounded-md border border-transparent px-1 text-lg font-semibold hover:border-ink-200 focus:border-accent-400" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            ) : (
              <h2 className="text-lg font-semibold">{t.name}</h2>
            )}
            <p className="px-1 text-xs text-ink-500">
              {t.file_name} · {tl('{n} tags', { n: t.tags.length })}
              {run ? ` · ${tl('Data')}: ${run.run.source_file}${run.run.sheet ? ` → "${run.run.sheet}"` : ''} (${tl('{n} rows', { n: run.rows.length })})` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {t.canEdit && (
              <label className="inline-flex items-center gap-1.5 text-xs">
                <input type="checkbox" className="accent-accent-600" checked={draft.shared} onChange={(e) => setDraft({ ...draft, shared: e.target.checked })} /> {tl('Company-wide')}
              </label>
            )}
            {t.canEdit && (
              <Button variant="primary" size="sm" disabled={!dirty || busy !== null} onClick={save}>
                {busy === 'save' ? <Spinner /> : null} {tl('Save changes')}
              </Button>
            )}
            {t.canEdit && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  window.confirm(tl('Delete this template and its uploaded data?')) &&
                  run$('del', async () => {
                    await api(`/api/merge/templates/${id}`, { method: 'DELETE' });
                    navigate('/templates');
                  })
                }
              >
                <Icon name="trash" className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-1" role="tablist">
          {([
            ['data', '1. Data & mapping'],
            ['template', '2. Template'],
            ['email', '3. Email'],
            ['generate', '4. Generate'],
          ] as Array<[Tab, string]>).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cx('rounded-lg px-3 py-1.5 text-sm font-medium', tab === k ? 'bg-ink-900 text-white' : 'text-ink-600 hover:bg-ink-100')}>
              {tl(label)}
            </button>
          ))}
        </div>
        {dirty && <p className="mt-2 text-xs text-amber-700">{tl('You have unsaved changes.')}</p>}
        {note && <p className="mt-2 rounded-lg bg-accent-50 px-3 py-2 text-sm text-accent-800">{note}</p>}
        <Err e={error} />
      </section>

      {tab === 'data' && <DataTab t={t} draft={draft} setDraft={setDraft} meta={meta} run={run} headers={headers} busy={busy} run$={run$} reload={load} />}
      {tab === 'template' && <TemplateTab t={t} busy={busy} run$={run$} reload={() => load(run?.run.id)} />}
      {tab === 'email' && <EmailTab t={t} draft={draft} setDraft={setDraft} headers={headers} />}
      {tab === 'generate' && <GenerateTab t={t} dirty={dirty} meta={meta} run={run} busy={busy} run$={run$} reloadRun={() => (run ? loadRun(run.run.id) : Promise.resolve())} setNote={setNote} />}
    </div>
  );
}

function DataTab({ t, draft, setDraft, meta, run, headers, busy, run$, reload }: {
  t: Template;
  draft: Template;
  setDraft(d: Template): void;
  meta: Meta;
  run: Run | null;
  headers: string[];
  busy: string | null;
  run$(k: string, fn: () => Promise<void>): Promise<void>;
  reload(runId?: string): Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<string[]>([]);
  const [sheet, setSheet] = useState('');
  const [runDate, setRunDate] = useState(() => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10));
  const sample = run?.rows.find((r) => r.passes && !r.excluded) ?? run?.rows[0];
  const setMap = (tag: string, m: TagMap) => setDraft({ ...draft, mapping: { ...draft.mapping, [tag]: m } });
  const unmapped = t.tags.filter((tag) => { const m = draft.mapping[tag]; return !m || (m.source === 'column' && !m.column); });

  return (
    <>
      <section className={card}>
        <h3 className="text-sm font-semibold">{tl('Upload the data')}</h3>
        <p className="mt-1 text-xs text-ink-500">{tl('The spreadsheet with one row per document (.xlsx or .csv). Next month, upload the new file here: the mapping is kept.')}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <Field label={tl('Data file')}>
            <FilePicker accept={['.xlsx', '.csv']} file={file} onChange={(f) => { setFile(f); setSheets([]); setSheet(''); }} />
          </Field>
          <Field label={tl('Date for {{date}} tags')}>
            <input type="date" className={inputCls} value={runDate} onChange={(e) => setRunDate(e.target.value)} />
          </Field>
          {sheets.length > 0 && (
            <Field label={tl('Sheet')}>
              <select className={inputCls} value={sheet} onChange={(e) => setSheet(e.target.value)}>
                <option value="">{tl('Choose…')}</option>
                {sheets.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          )}
          <div className="flex items-end">
            <Button
              variant="primary"
              disabled={!file || busy !== null || (sheets.length > 0 && !sheet)}
              onClick={() =>
                run$('upload', async () => {
                  const form = new FormData();
                  form.append('runDate', runDate);
                  if (sheet) form.append('sheet', sheet);
                  form.append('file', file!);
                  try {
                    const r = await upload<{ id: string }>(`/api/merge/templates/${t.id}/runs`, form);
                    setSheets([]);
                    await reload(r.id);
                  } catch (err) {
                    const s = (err as { sheets?: string[] }).sheets;
                    if (s?.length) setSheets(s);
                    throw err;
                  }
                })
              }
            >
              {busy === 'upload' ? <Spinner /> : <Icon name="plus" className="h-4 w-4" />} {tl('Upload data')}
            </Button>
          </div>
        </div>
        {t.runs.length > 1 && (
          <p className="mt-3 text-xs text-ink-500">
            {tl('Earlier uploads')}:{' '}
            {t.runs.slice(0, 8).map((r, i) => (
              <button key={r.id} disabled={!!r.purged_at} className="mr-2 font-medium text-accent-700 hover:underline disabled:text-ink-400" onClick={() => void reload(r.id)} title={r.purged_at ? tl('Data removed (retention period)') : ''}>
                {new Date(r.created_at).toLocaleDateString()} ({r.rows}){i === 0 ? '' : ''}
              </button>
            ))}
          </p>
        )}
      </section>

      <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{tl('Match each tag to a column')}</h3>
          {t.canEdit && headers.length > 0 && unmapped.length > 0 && (
            <Button
              size="sm"
              disabled={busy !== null}
              onClick={() =>
                run$('suggest', async () => {
                  const r = await api<{ mapping: Record<string, string> }>(`/api/merge/templates/${t.id}/suggest`, { body: { headers, tags: unmapped } });
                  const next = { ...draft.mapping };
                  for (const [tag, column] of Object.entries(r.mapping)) next[tag] = { source: 'column', column, format: next[tag]?.format ?? 'none' };
                  setDraft({ ...draft, mapping: next });
                })
              }
            >
              {busy === 'suggest' ? <Spinner /> : <Icon name="spark" className="h-3.5 w-3.5" />} {tl('Suggest the rest with AI')}
            </Button>
          )}
        </div>
        {!headers.length && <p className="mt-2 text-sm text-ink-500">{tl('Upload the data first; tags are matched to its columns automatically by name.')}</p>}
        {t.tags.length === 0 ? (
          <p className="mt-2 text-sm text-ink-500">{tl('This template has no {{tags}} yet. Add them in Word, or in the Template tab by selecting text.')}</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-500">
                  <th className="py-1 pr-2">{tl('Tag')}</th>
                  <th className="py-1 pr-2">{tl('Filled from')}</th>
                  <th className="py-1 pr-2">{tl('Format')}</th>
                  <th className="py-1">{tl('Example (first row)')}</th>
                </tr>
              </thead>
              <tbody>
                {t.tags.map((tag) => {
                  const m = draft.mapping[tag] ?? { source: 'column' as const };
                  const value = m.source === 'column' ? (m.column ? `${m.column}` : '') : m.source;
                  const example = sample?.values[tag];
                  const saved = JSON.stringify(t.mapping[tag]) === JSON.stringify(draft.mapping[tag]);
                  return (
                    <tr key={tag} className="border-t border-ink-100 align-top">
                      <td className="py-2 pr-2 font-mono text-xs"><mark className="rounded bg-amber-100 px-1">{`{{${tag}}}`}</mark></td>
                      <td className="py-2 pr-2">
                        <select
                          className={cx(inputCls, 'py-1 text-sm', !value && 'border-red-300')}
                          disabled={!t.canEdit}
                          value={m.source === 'column' ? `col:${m.column ?? ''}` : m.source}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === 'text') setMap(tag, { source: 'text', text: m.text ?? '' });
                            else if (v === 'run_date') setMap(tag, { source: 'run_date', format: 'date_ms' });
                            else setMap(tag, { source: 'column', column: v.slice(4) || undefined, format: m.format ?? 'none' });
                          }}
                        >
                          <option value="col:">{tl('— choose a column —')}</option>
                          {headers.map((h) => <option key={h} value={`col:${h}`}>{h}</option>)}
                          {m.source === 'column' && m.column && !headers.includes(m.column) && <option value={`col:${m.column}`}>{m.column} ({tl('not in this file')})</option>}
                          <option value="run_date">{tl('Date of this batch')}</option>
                          <option value="text">{tl('Fixed text…')}</option>
                        </select>
                        {m.source === 'text' && (
                          <input className={cx(inputCls, 'mt-1 py-1 text-sm')} disabled={!t.canEdit} value={m.text ?? ''} placeholder={tl('Same text on every document')} onChange={(e) => setMap(tag, { ...m, text: e.target.value })} />
                        )}
                      </td>
                      <td className="py-2 pr-2">
                        {m.source !== 'text' && (
                          <select className={cx(inputCls, 'py-1 text-sm')} disabled={!t.canEdit} value={m.format ?? 'none'} onChange={(e) => setMap(tag, { ...m, format: e.target.value })}>
                            {Object.entries(meta.formats).map(([k, label]) => <option key={k} value={k}>{tl(label)}</option>)}
                          </select>
                        )}
                      </td>
                      <td className="py-2 text-sm">
                        {saved ? (example ? <span className="text-ink-800">{example}</span> : sample ? <span className="text-xs text-red-600">{tl('blank')}</span> : null) : <span className="text-xs text-ink-400">{tl('Save to see')}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={card}>
        <h3 className="text-sm font-semibold">{tl('Which rows get a document')}</h3>
        <p className="mt-1 text-xs text-ink-500">{tl('Optional conditions; all must be true. For example "remarks Ain is blank" or "Overdue month is at least 2".')}</p>
        <div className="mt-3 space-y-2">
          {draft.filters.map((f, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <select className={cx(inputCls, 'w-56! py-1 text-sm')} disabled={!t.canEdit} value={f.column} onChange={(e) => setDraft({ ...draft, filters: draft.filters.map((x, j) => (j === i ? { ...x, column: e.target.value } : x)) })}>
                {!headers.includes(f.column) && <option value={f.column}>{f.column || tl('— column —')}</option>}
                {headers.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
              <select className={cx(inputCls, 'w-40! py-1 text-sm')} disabled={!t.canEdit} value={f.op} onChange={(e) => setDraft({ ...draft, filters: draft.filters.map((x, j) => (j === i ? { ...x, op: e.target.value } : x)) })}>
                {Object.entries(meta.ops).map(([k, label]) => <option key={k} value={k}>{tl(label)}</option>)}
              </select>
              {!['blank', 'not_blank'].includes(f.op) && (
                <input className={cx(inputCls, 'w-40! py-1 text-sm')} disabled={!t.canEdit} value={f.value ?? ''} onChange={(e) => setDraft({ ...draft, filters: draft.filters.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />
              )}
              {t.canEdit && (
                <button className="text-ink-400 hover:text-red-600" onClick={() => setDraft({ ...draft, filters: draft.filters.filter((_, j) => j !== i) })} aria-label={tl('Remove')}>
                  <Icon name="trash" className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
          {t.canEdit && (
            <Button size="sm" variant="ghost" disabled={!headers.length || draft.filters.length >= 10} onClick={() => setDraft({ ...draft, filters: [...draft.filters, { column: headers[0], op: 'not_blank' }] })}>
              <Icon name="plus" className="h-3.5 w-3.5" /> {tl('Add condition')}
            </Button>
          )}
        </div>
        <div className="mt-4 max-w-xl">
          <Field label={tl('File name for each document')} hint={tl('Use tags, e.g. Notis_{{customername}}_{{accountnumber}}. {{row}} is the spreadsheet row.')}>
            <input className={inputCls} disabled={!t.canEdit} value={draft.filename_pattern} onChange={(e) => setDraft({ ...draft, filename_pattern: e.target.value })} />
          </Field>
        </div>
      </section>
    </>
  );
}

function TemplateTab({ t, busy, run$, reload }: { t: Template; busy: string | null; run$(k: string, fn: () => Promise<void>): Promise<void>; reload(): Promise<void> }) {
  const [html, setHtml] = useState<string | null>(null);
  const [selected, setSelected] = useState('');
  const [tagName, setTagName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const loadPreview = () => api<{ html: string }>(`/api/merge/templates/${t.id}/preview`).then((r) => setHtml(r.html));
  useEffect(() => void loadPreview(), [t.id, t.tags.join(',')]);
  const suggestName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);
  return (
    <section className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{tl('Template preview')}</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => run$('dl', () => download(`/api/merge/templates/${t.id}/file.docx`, t.file_name))}>
            <Icon name="download" className="h-3.5 w-3.5" /> {tl('Download Word file')}
          </Button>
          {t.canEdit && (
            <>
              <div className="w-64"><FilePicker compact accept={['.docx']} file={file} onChange={setFile} /></div>
              <Button
                size="sm"
                disabled={!file || busy !== null}
                onClick={() =>
                  run$('replace', async () => {
                    const form = new FormData();
                    form.append('file', file!);
                    await upload(`/api/merge/templates/${t.id}/file`, form);
                    setFile(null);
                    await reload();
                  })
                }
              >
                {tl('Replace Word file')}
              </Button>
            </>
          )}
        </div>
      </div>
      {t.canEdit && (
        <p className="mt-1 text-xs text-ink-500">{tl('To add a tag without Word: select the sample text in the preview (for example a name), give the tag a name and press Make tag. The formatting of that text is kept.')}</p>
      )}
      {t.canEdit && selected && (
        <div className="sticky top-0 z-10 mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 p-2 text-sm ring-1 ring-amber-200">
          <span>
            {tl('Replace')} “<strong>{selected.slice(0, 60)}</strong>” {tl('with')}
          </span>
          <span className="font-mono">{'{{'}</span>
          <input className={cx(inputCls, 'w-44! py-1 font-mono text-sm')} value={tagName} onChange={(e) => setTagName(e.target.value.replace(/\s+/g, '_'))} />
          <span className="font-mono">{'}}'}</span>
          <Button
            size="sm"
            variant="primary"
            disabled={!tagName || busy !== null}
            onClick={() =>
              run$('tag', async () => {
                await api(`/api/merge/templates/${t.id}/insert-tag`, { body: { text: selected, tag: tagName } });
                setSelected('');
                await reload();
              })
            }
          >
            {tl('Make tag')}
          </Button>
          <button className="text-xs text-ink-500 hover:underline" onClick={() => setSelected('')}>{tl('Cancel')}</button>
        </div>
      )}
      <div
        className="prose prose-sm mt-4 max-w-none rounded-lg border border-ink-100 bg-white p-6 [&_mark]:rounded [&_mark]:bg-amber-100 [&_mark]:px-0.5 [&_table]:border [&_td]:border [&_td]:px-2"
        onMouseUp={() => {
          if (!t.canEdit) return;
          const s = window.getSelection()?.toString().trim() ?? '';
          if (s && s.length <= 300 && !s.includes('{{')) {
            setSelected(s);
            setTagName(suggestName(s));
          }
        }}
      >
        {html == null ? <Spinner /> : <div dangerouslySetInnerHTML={{ __html: html }} />}
      </div>
      <p className="mt-2 text-xs text-ink-500">{tl('The preview shows the text of the Word file; the documents keep the original layout, fonts and logo.')}</p>
    </section>
  );
}

function EmailTab({ t, draft, setDraft, headers }: { t: Template; draft: Template; setDraft(d: Template): void; headers: string[] }) {
  const e = draft.email;
  const set = (patch: EmailSettings) => setDraft({ ...draft, email: { ...e, ...patch } });
  return (
    <section className={card}>
      <h3 className="text-sm font-semibold">{tl('Email (optional)')}</h3>
      <p className="mt-1 text-xs text-ink-500">{tl('To send each document by email (Outlook drafts, or directly once the mailbox is set up). The subject and message can use the same {{tags}}.')}</p>
      <div className="mt-3 grid max-w-3xl gap-3">
        <Field label={tl('Email address column')}>
          <select className={inputCls} disabled={!t.canEdit} value={e.toColumn ?? ''} onChange={(ev) => set({ toColumn: ev.target.value || undefined })}>
            <option value="">{tl('— none (documents only) —')}</option>
            {e.toColumn && !headers.includes(e.toColumn) && <option value={e.toColumn}>{e.toColumn}</option>}
            {headers.map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
        </Field>
        <Field label={tl('Subject')}>
          <input className={inputCls} disabled={!t.canEdit} value={e.subject ?? ''} placeholder={t.name} onChange={(ev) => set({ subject: ev.target.value })} />
        </Field>
        <Field label={tl('Message')} hint={tl('Plain text; a blank line starts a new paragraph. The document is attached.')}>
          <textarea className={cx(inputCls, 'min-h-48 font-sans')} disabled={!t.canEdit} value={e.body ?? ''} placeholder={'Assalamualaikum / Salam Sejahtera {{customername}},\n\nBersama ini dilampirkan ...'} onChange={(ev) => set({ body: ev.target.value })} />
        </Field>
        <p className="text-xs text-ink-500">
          {tl('Tags you can use')}: {t.tags.map((tag) => <code key={tag} className="mr-1 rounded bg-ink-50 px-1">{`{{${tag}}}`}</code>)}
        </p>
      </div>
    </section>
  );
}

function GenerateTab({ t, dirty, meta, run, busy, run$, reloadRun, setNote }: {
  t: Template;
  dirty: boolean;
  meta: Meta;
  run: Run | null;
  busy: string | null;
  run$(k: string, fn: () => Promise<void>): Promise<void>;
  reloadRun(): Promise<void>;
  setNote(s: string | null): void;
}) {
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState<'selected' | 'all'>('selected');
  if (!run) return <section className={card}><p className="text-sm text-ink-500">{tl('Upload the data in step 1 first.')}</p></section>;
  const cols = t.tags.slice(0, 4);
  const selected = run.rows.filter((r) => r.passes && !r.excluded);
  const blanks = selected.filter((r) => r.blank.length).length;
  const noEmail = t.email.toColumn ? selected.filter((r) => !r.email).length : 0;
  const rows = show === 'all' ? run.rows : selected;
  const purged = !!run.run.purged_at;
  const q = `/api/merge/runs/${run.run.id}`;
  return (
    <>
      <section className={card}>
        {dirty && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{tl('Save your changes first: documents use the saved mapping.')}</p>}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            [tl('Documents'), selected.length, 'text-emerald-700'],
            [tl('With blank tags'), blanks, blanks ? 'text-amber-700' : ''],
            [tl('Not matching conditions'), run.rows.filter((r) => !r.passes).length, ''],
            [tl('No valid email'), t.email.toColumn ? noEmail : '—', noEmail ? 'text-red-700' : ''],
          ].map(([label, value, tone]) => (
            <div key={String(label)} className="rounded-lg bg-ink-50 p-3">
              <p className="text-xs text-ink-500">{label}</p>
              <p className={cx('text-lg font-semibold tabular-nums', String(tone))}>{value}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" disabled={!selected.length || purged || dirty || busy !== null} onClick={() => run$('docs', () => download(`${q}/documents.zip?format=docx`, 'documents.zip'))}>
            {busy === 'docs' ? <Spinner /> : <Icon name="download" className="h-4 w-4" />} {tl('Download {n} Word documents', { n: selected.length })}
          </Button>
          {meta.pdf && (
            <Button disabled={!selected.length || purged || dirty || busy !== null} onClick={() => run$('pdfs', () => download(`${q}/documents.zip?format=pdf`, 'documents.zip'))}>
              {busy === 'pdfs' ? <Spinner /> : null} {tl('Download as PDF')}
            </Button>
          )}
          <Button disabled={!selected.length || !t.email.toColumn || purged || dirty || busy !== null} title={!t.email.toColumn ? tl('Choose the email column in step 3') : ''} onClick={() => run$('drafts', () => download(`${q}/drafts.zip?format=${meta.pdf ? 'pdf' : 'docx'}`, 'drafts.zip'))}>
            {busy === 'drafts' ? <Spinner /> : <Icon name="send" className="h-4 w-4" />} {tl('Download Outlook drafts')}
          </Button>
          <button className="text-xs font-medium text-accent-700 hover:underline" onClick={() => run$('log', () => download(`${q}/log.csv`, 'log.csv'))}>
            {tl('Send log (CSV)')}
          </button>
        </div>
        {!meta.pdf && <p className="mt-2 text-xs text-ink-500">{tl('Documents are Word files. PDF output needs a converter on the server (ask the admin).')}</p>}
        {meta.directSending && t.email.toColumn && (
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-ink-100 p-3">
            <span className="text-sm font-medium">{tl('Send directly')}</span>
            <Button size="sm" disabled={!selected.length || busy !== null} onClick={() => run$('test', async () => { const r = await api<{ to: string }>(`${q}/test`, { body: {} }); setNote(tl('Test copy sent to {to}.', { to: r.to })); })}>
              {tl('Send me a test copy')}
            </Button>
            <input className={cx(inputCls, 'w-24! py-1')} placeholder="SEND" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label={tl('Type SEND to confirm')} />
            <Button size="sm" variant="danger" disabled={confirm !== 'SEND' || busy !== null} onClick={() => run$('send', async () => { const r = await api<{ queued: number }>(`${q}/send`, { body: { confirm } }); setConfirm(''); setNote(tl('{n} emails are being sent.', { n: r.queued })); await reloadRun(); })}>
              {tl('Send {n} emails', { n: selected.length - noEmail })}
            </Button>
          </div>
        )}
      </section>
      <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{tl('Rows')}</h3>
          <select className="rounded-lg border border-ink-200 bg-white px-2 py-1 text-sm" value={show} onChange={(e) => setShow(e.target.value as 'selected' | 'all')}>
            <option value="selected">{tl('Documents to make ({n})', { n: selected.length })}</option>
            <option value="all">{tl('All rows ({n})', { n: run.rows.length })}</option>
          </select>
        </div>
        <div className="mt-3 max-h-[36rem] overflow-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="text-left text-xs text-ink-500">
                <th className="py-1 pr-2">{tl('Include')}</th>
                <th className="py-1 pr-2">{tl('Row')}</th>
                {cols.map((c) => <th key={c} className="py-1 pr-2 font-mono">{`{{${c}}}`}</th>)}
                {t.email.toColumn && <th className="py-1 pr-2">{tl('Email')}</th>}
                <th className="py-1 pr-2">{tl('Check')}</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 500).map((r) => (
                <tr key={r.id} className={cx('border-t border-ink-100 align-top', (!r.passes || r.excluded) && 'text-ink-400')}>
                  <td className="py-1.5 pr-2">
                    <input
                      type="checkbox"
                      className="accent-accent-600"
                      checked={!r.excluded}
                      disabled={!r.passes || purged || r.delivery === 'sent' || busy !== null}
                      onChange={(e) => run$(`row`, async () => { await api(`${q}/rows/${r.id}`, { method: 'PATCH', body: { excluded: !e.target.checked } }); await reloadRun(); })}
                      aria-label={tl('Include')}
                    />
                  </td>
                  <td className="py-1.5 pr-2 tabular-nums">{r.row_no}</td>
                  {cols.map((c) => <td key={c} className="max-w-48 truncate py-1.5 pr-2" title={r.values[c]}>{r.values[c]}</td>)}
                  {t.email.toColumn && <td className="py-1.5 pr-2 [overflow-wrap:anywhere]">{r.email ?? <span className="text-xs text-red-600">{tl('none')}</span>}</td>}
                  <td className="py-1.5 pr-2 text-xs">
                    {!r.passes && <span>{tl('Does not match conditions')}</span>}
                    {r.passes && r.blank.length > 0 && <span className="text-amber-700">⚠ {tl('Blank')}: {r.blank.map((b) => `{{${b}}}`).join(', ')}</span>}
                    {r.delivery === 'sent' && <Badge tone="blue">{tl('Sent')}</Badge>}
                    {r.delivery === 'queued' && <Badge tone="blue">{tl('Sending…')}</Badge>}
                    {r.delivery === 'failed' && <Badge tone="red" title={r.delivery_error ?? ''}>{tl('Failed')}</Badge>}
                  </td>
                  <td className="py-1.5 text-right">
                    {!purged && (
                      <button className="whitespace-nowrap text-xs font-medium text-accent-700 hover:underline" onClick={() => run$('one', () => download(`${q}/rows/${r.id}/document?format=docx`, 'document.docx'))}>
                        {tl('Word')}
                      </button>
                    )}
                    {!purged && meta.pdf && (
                      <a className="ml-2 whitespace-nowrap text-xs font-medium text-accent-700 hover:underline" href={`${q}/rows/${r.id}/document?format=pdf`} target="_blank" rel="noreferrer">PDF</a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 500 && <p className="mt-1 text-xs text-ink-400">{tl('Showing 500 of {n} rows; downloads include all.', { n: rows.length })}</p>}
        </div>
      </section>
    </>
  );
}
