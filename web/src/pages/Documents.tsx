import { useCallback, useEffect, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { Badge, Button, cx, Field, Icon, inputCls, Spinner } from '../components/ui';
import { dateLocale, getLang, tl } from '../i18n';
import { Shell } from './Plan';

type Status = 'queued' | 'writing' | 'draft' | 'approved' | 'error';

interface DocListRow {
  id: string;
  doc_type: 'exec_brief' | 'board_paper';
  language: 'en' | 'ms';
  subject: string;
  status: Status;
  ref_no: string | null;
  author: string | null;
  department: string | null;
  updated_at: string;
}

interface Section {
  key: string;
  heading: string;
  kind: 'write' | 'risks' | 'action_plan' | 'signoff';
  content: string;
  status: 'pending' | 'writing' | 'done';
}

interface Doc extends DocListRow {
  addressed_to: string;
  sections: Section[];
  error: string | null;
  approved_at: string | null;
  approver: string | null;
  conversation_id: string | null;
  type_name: string;
  title: string;
  review_before_acting: boolean;
  tbc: number;
  can: { edit: boolean; approve: boolean; download: boolean; delete: boolean; retry: boolean };
}

const TYPE_LABEL = { exec_brief: 'Executive brief', board_paper: 'Board paper' } as const;
const STATUS: Record<Status, { label: string; tone: 'neutral' | 'green' | 'amber' | 'red' | 'blue' }> = {
  queued: { label: 'Waiting to start', tone: 'neutral' },
  writing: { label: 'Writing', tone: 'blue' },
  draft: { label: 'Draft', tone: 'amber' },
  approved: { label: 'Approved', tone: 'green' },
  error: { label: 'Failed', tone: 'red' },
};
const fmt = (d: string) => new Date(d).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' });

/** Official documents: executive briefs and board papers drafted from council verdicts. */
export default function DocumentsPage() {
  const { id } = useParams();
  return id ? <DocumentDetail id={id} /> : <DocumentList />;
}

function DocumentList() {
  const [rows, setRows] = useState<DocListRow[] | null>(null);
  useEffect(() => {
    api<DocListRow[]>('/api/documents').then(setRows).catch(() => setRows([]));
  }, []);
  return (
    <Shell title={tl('Documents')}>
      <p className="mb-4 max-w-3xl text-sm text-ink-600">
        {tl('Executive briefs and board papers on the company letterhead. To draft one, open a council verdict and choose "Official document".')}
      </p>
      {!rows ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-ink-200 bg-white p-6 text-center text-sm text-ink-500">{tl('No documents yet.')}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-ink-100 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-left text-xs text-ink-500">
              <tr>
                <th className="px-3 py-2 font-medium">{tl('Subject')}</th>
                <th className="px-3 py-2 font-medium">{tl('Type')}</th>
                <th className="px-3 py-2 font-medium">{tl('Status')}</th>
                <th className="px-3 py-2 font-medium">{tl('Reference')}</th>
                <th className="px-3 py-2 font-medium">{tl('Prepared by')}</th>
                <th className="px-3 py-2 font-medium">{tl('Updated')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-ink-100 hover:bg-ink-50">
                  <td className="px-3 py-2">
                    <Link to={`/documents/${r.id}`} className="font-medium text-accent-700 hover:underline">
                      {r.subject}
                    </Link>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {tl(TYPE_LABEL[r.doc_type])} · {r.language === 'ms' ? 'BM' : 'EN'}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={STATUS[r.status].tone}>{tl(STATUS[r.status].label)}</Badge>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{r.ref_no ?? '-'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.author ?? '-'}
                    {r.department && <span className="text-ink-400"> · {r.department}</span>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-ink-500">{fmt(r.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}

function DocumentDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Doc>(`/api/documents/${id}`)
      .then((d) => {
        setDoc(d);
        setError(null);
      })
      .catch((e) => setError((e as Error).message));
  }, [id]);
  useEffect(load, [load]);

  const working = !!doc && (doc.status === 'queued' || doc.status === 'writing' || doc.sections.some((s) => s.status === 'writing'));
  // Live updates while sections are written, with a slow poll in case the event stream drops.
  useEffect(() => {
    const es = new EventSource('/api/events');
    es.addEventListener('document', ((ev: MessageEvent) => {
      if (JSON.parse(ev.data).id === id) load();
    }) as EventListener);
    return () => es.close();
  }, [id, load]);
  useEffect(() => {
    if (!working) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [working, load]);

  if (error && !doc) return <Shell title={tl('Document')} back="/documents"><p className="text-sm text-red-700">{error}</p></Shell>;
  if (!doc) return <Shell title={tl('Document')} back="/documents"><Spinner /></Shell>;

  const done = doc.sections.filter((s) => s.status === 'done').length;
  const current = doc.sections.find((s) => s.status === 'writing');

  async function act(name: string, fn: () => Promise<unknown>) {
    setBusy(name);
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const approve = () => {
    const msg = doc.tbc
      ? tl('{n} item(s) marked [TBC] are still open. Approve anyway? Approval locks the document and issues its reference number.', { n: doc.tbc })
      : tl('Approve this document? Approval locks it and issues its reference number.');
    if (confirm(msg)) void act('approve', () => api(`/api/documents/${id}/approve`, { method: 'POST' }));
  };

  const download = (
    <a
      href={doc.can.download ? `/api/documents/${id}/document.docx` : undefined}
      download
      aria-disabled={!doc.can.download}
      title={doc.can.download ? tl('Download the Word document on the letterhead') : tl('Available once the document is approved')}
      className={cx(
        'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium',
        doc.can.download ? 'bg-ink-900 text-white hover:bg-ink-800' : 'cursor-not-allowed bg-ink-100 text-ink-400',
      )}
    >
      <Icon name="download" className="h-4 w-4" /> {tl('Download Word')}
    </a>
  );

  return (
    <Shell title={doc.subject} back="/documents" right={download}>
      <div className="mx-auto max-w-4xl space-y-4">
        {/* Status banner */}
        {working && (
          <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
            <div className="flex items-center gap-2">
              <Spinner />
              {doc.status === 'queued'
                ? tl('Waiting for the model: the document starts as soon as it is free.')
                : current
                  ? tl('Writing "{s}" ({n} of {t})…', { s: current.heading, n: done + 1, t: doc.sections.length })
                  : tl('Writing…')}
            </div>
            {doc.status !== 'draft' && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sky-100">
                <div className="h-full bg-sky-500 transition-all" style={{ width: `${Math.round((done / doc.sections.length) * 100)}%` }} />
              </div>
            )}
          </div>
        )}
        {doc.status === 'error' && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <span className="flex-1">{tl('Writing stopped: {e}', { e: doc.error ?? tl('unknown error') })}</span>
            {doc.can.retry && (
              <Button size="sm" onClick={() => act('retry', () => api(`/api/documents/${id}/retry`, { method: 'POST' }))} disabled={busy !== null}>
                <Icon name="retry" className="h-3.5 w-3.5" /> {tl('Carry on')}
              </Button>
            )}
          </div>
        )}
        {doc.status === 'draft' && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">{tl('Review before issuing')}</p>
            <p className="mt-0.5">
              {tl('Read every section and correct anything that is not right.')}{' '}
              {doc.tbc > 0 && <strong>{tl('{n} item(s) marked [TBC] still need to be filled in.', { n: doc.tbc })}</strong>}
            </p>
            {doc.review_before_acting && !doc.can.approve && (
              <p className="mt-1">{tl('Your department lead or an admin must approve this document before it can be downloaded.')}</p>
            )}
            {doc.error && <p className="mt-1 text-red-700">{doc.error}</p>}
          </div>
        )}
        {doc.status === 'approved' && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
            {tl('Approved by {who} on {date}. Reference {ref}.', { who: doc.approver ?? '-', date: doc.approved_at ? fmt(doc.approved_at) : '-', ref: doc.ref_no ?? '-' })}
          </div>
        )}
        {error && <p className="text-sm text-red-700">{error}</p>}

        {/* The page */}
        <article className="rounded-xl border border-ink-100 bg-white p-5 shadow-sm md:p-8">
          <h2 className="mb-4 text-center text-lg font-bold tracking-wide">{doc.title}</h2>
          <Details doc={doc} onSaved={load} />
          <hr className="my-5 border-ink-100" />
          <div className="space-y-6">
            {doc.sections.map((s, i) => (
              <SectionView key={s.key} doc={doc} section={s} index={i} onChanged={load} />
            ))}
          </div>
        </article>

        <div className="flex flex-wrap items-center gap-2">
          {doc.can.approve && (
            <Button variant="primary" onClick={approve} disabled={busy !== null || working}>
              {busy === 'approve' && <Spinner />} <Icon name="shield" className="h-4 w-4" /> {tl('Approve and issue reference')}
            </Button>
          )}
          {doc.conversation_id && (
            <Link to={`/c/${doc.conversation_id}`} className="text-sm text-accent-700 hover:underline">
              {tl('Open the council conversation')}
            </Link>
          )}
          {doc.can.delete && (
            <Button
              variant="danger"
              className="ml-auto"
              disabled={busy !== null}
              onClick={() => {
                if (confirm(tl('Delete this document?'))) void act('delete', async () => {
                  await api(`/api/documents/${id}`, { method: 'DELETE' });
                  navigate('/documents');
                });
              }}
            >
              <Icon name="trash" className="h-4 w-4" /> {tl('Delete')}
            </Button>
          )}
        </div>
      </div>
    </Shell>
  );
}

function Details({ doc, onSaved }: { doc: Doc; onSaved(): void }) {
  const [to, setTo] = useState(doc.addressed_to);
  const [subject, setSubject] = useState(doc.subject);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setTo(doc.addressed_to);
    setSubject(doc.subject);
  }, [doc.addressed_to, doc.subject]);
  const dirty = to !== doc.addressed_to || subject !== doc.subject;
  const ms = doc.language === 'ms';
  const row = (label: string, value: ReactNode) => (
    <div className="grid grid-cols-[6.5rem_1fr] items-center gap-2 text-sm">
      <span className="font-semibold">{label}</span>
      <span className="min-w-0">{value}</span>
    </div>
  );
  return (
    <div className="space-y-1.5">
      {row(ms ? 'Kepada' : 'To', doc.can.edit ? <input className={cx(inputCls, 'py-1')} value={to} onChange={(e) => setTo(e.target.value)} placeholder={tl('e.g. Board of Directors')} /> : doc.addressed_to || '-')}
      {row(ms ? 'Daripada' : 'From', [doc.author, doc.department].filter(Boolean).join(', '))}
      {row(ms ? 'Rujukan' : 'Ref', <span className="font-mono">{doc.ref_no ?? (ms ? 'DRAF' : 'DRAFT')}</span>)}
      {row(ms ? 'Perkara' : 'Subject', doc.can.edit ? <input className={cx(inputCls, 'py-1 font-semibold')} value={subject} onChange={(e) => setSubject(e.target.value)} /> : <strong>{doc.subject}</strong>)}
      {dirty && (
        <div className="pt-1 text-right">
          <Button
            size="sm"
            variant="primary"
            disabled={saving || subject.trim().length < 3}
            onClick={async () => {
              setSaving(true);
              await api(`/api/documents/${doc.id}`, { method: 'PATCH', body: { subject, addressedTo: to } }).finally(() => setSaving(false));
              onSaved();
            }}
          >
            {tl('Save details')}
          </Button>
        </div>
      )}
    </div>
  );
}

const QUICK_REWRITES = ['Shorter', 'More formal', 'More detail', 'Simpler language'];

function SectionView({ doc, section: s, index, onChanged }: { doc: Doc; section: Section; index: number; onChanged(): void }) {
  const [mode, setMode] = useState<null | 'edit' | 'rewrite'>(null);
  const [text, setText] = useState(s.content);
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setText(s.content), [s.content]);

  const numbered = doc.doc_type === 'board_paper';
  const heading = numbered ? `${index + 1}.0  ${s.heading.toUpperCase()}` : s.heading;

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setMode(null);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const rewrite = (how: string) => run(() => api(`/api/documents/${doc.id}/sections/${s.key}/rewrite`, { body: { instruction: how } }));

  return (
    <section className="group">
      <div className="mb-1.5 flex items-center gap-2">
        <h3 className={cx('flex-1 font-semibold', numbered ? 'text-sm tracking-wide' : 'text-base text-accent-800')}>{heading}</h3>
        {s.status === 'writing' && <Spinner />}
        {doc.can.edit && s.status === 'done' && mode === null && (
          <span className="flex gap-1 opacity-60 transition-opacity group-hover:opacity-100">
            <Button size="sm" variant="ghost" onClick={() => setMode('edit')}>
              <Icon name="edit" className="h-3.5 w-3.5" /> {tl('Edit')}
            </Button>
            {s.kind === 'write' && (
              <Button size="sm" variant="ghost" onClick={() => setMode('rewrite')}>
                <Icon name="retry" className="h-3.5 w-3.5" /> {tl('Rewrite')}
              </Button>
            )}
          </span>
        )}
      </div>

      {s.status === 'pending' ? (
        <p className="text-sm text-ink-400 italic">{tl('Not written yet.')}</p>
      ) : s.status === 'writing' && !s.content ? (
        <p className="text-sm text-ink-400 italic">{tl('Writing…')}</p>
      ) : mode === 'edit' ? (
        <div className="space-y-2">
          <textarea className={cx(inputCls, 'min-h-48 font-mono text-xs')} value={text} onChange={(e) => setText(e.target.value)} />
          <p className="text-xs text-ink-400">{tl('Markdown: blank line between paragraphs, "- " for bullets, **bold**. Tables use | pipes |.')}</p>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" disabled={busy} onClick={() => run(() => api(`/api/documents/${doc.id}/sections/${s.key}`, { method: 'PUT', body: { content: text } }))}>
              {tl('Save')}
            </Button>
            <Button size="sm" onClick={() => { setText(s.content); setMode(null); }}>
              {tl('Cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <div className={cx(s.status === 'writing' && 'opacity-50', numbered && 'pl-8')}>
          <DocMarkdown text={s.content} />
        </div>
      )}

      {mode === 'rewrite' && (
        <div className="mt-2 space-y-2 rounded-lg border border-ink-200 bg-ink-50 p-2">
          <div className="flex flex-wrap gap-1">
            {QUICK_REWRITES.map((q) => (
              <Button key={q} size="sm" disabled={busy} onClick={() => rewrite(q)}>
                {tl(q)}
              </Button>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (instruction.trim().length >= 2) void rewrite(instruction.trim());
            }}
          >
            <input className={cx(inputCls, 'py-1 text-sm')} value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder={tl('Or say what to change, e.g. "mention the Q3 figures"')} />
            <Button size="sm" variant="primary" disabled={busy || instruction.trim().length < 2}>
              {tl('Rewrite')}
            </Button>
            <Button size="sm" type="button" onClick={() => setMode(null)}>
              {tl('Cancel')}
            </Button>
          </form>
        </div>
      )}
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </section>
  );
}

/** Section text as it will read in Word, with [TBC: ...] placeholders highlighted. */
function DocMarkdown({ text }: { text: string }) {
  const marked = text.replace(/\[TBC:([^\]]*)\]/gi, (_m, what: string) => `[TBC:${what}](#tbc)`);
  return (
    <div className="prose prose-sm max-w-none text-justify prose-p:my-2 prose-li:my-0.5 prose-table:text-xs prose-th:bg-ink-50 prose-th:px-2 prose-td:px-2 prose-strong:text-ink-900">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) =>
            href === '#tbc' ? <mark className="rounded bg-yellow-200 px-0.5 text-ink-900">[{children}]</mark> : <a href={href}>{children}</a>,
        }}
      >
        {marked}
      </ReactMarkdown>
    </div>
  );
}

// ── "Official document" from a verdict ───────────────────────────────────────

/** The form under a council verdict: pick the document type and who it is for, then open it. */
export function OfficialDocForm({ messageId, onClose }: { messageId: string; onClose(): void }) {
  const navigate = useNavigate();
  const [type, setType] = useState<'exec_brief' | 'board_paper'>('exec_brief');
  const [language, setLanguage] = useState<'en' | 'ms'>(getLang());
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-3 rounded-lg border border-ink-200 bg-white p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const r = await api<{ id: string }>(`/api/messages/${messageId}/documents`, {
            body: { type, language, addressedTo: to.trim(), subject: subject.trim() || undefined },
          });
          navigate(`/documents/${r.id}`);
        } catch (err) {
          setError((err as Error).message);
          setBusy(false);
        }
      }}
    >
      <p className="text-xs text-ink-500">{tl('Write this decision up as a formal document on the company letterhead. It is written section by section; you can edit and approve it before downloading.')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={tl('Document')}>
          <select className={inputCls} value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            <option value="exec_brief">{tl('Executive brief (1-2 pages)')}</option>
            <option value="board_paper">{tl('Board paper (Kertas Cadangan)')}</option>
          </select>
        </Field>
        <Field label={tl('Language')}>
          <select className={inputCls} value={language} onChange={(e) => setLanguage(e.target.value as 'en' | 'ms')}>
            <option value="en">English</option>
            <option value="ms">Bahasa Malaysia</option>
          </select>
        </Field>
        <Field label={tl('Addressed to')}>
          <input className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} placeholder={tl('e.g. Board of Directors')} maxLength={200} />
        </Field>
        <Field label={tl('Subject')} hint={tl('Leave empty to use the conversation title.')}>
          <input className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />
        </Field>
      </div>
      {error && <p className="text-xs text-red-700">{error}</p>}
      <div className="flex gap-2">
        <Button variant="primary" size="sm" disabled={busy}>
          {busy && <Spinner />} {tl('Draft the document')}
        </Button>
        <Button size="sm" type="button" onClick={onClose}>
          {tl('Cancel')}
        </Button>
      </div>
    </form>
  );
}
