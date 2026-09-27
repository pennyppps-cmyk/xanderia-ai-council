import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { Badge, Button, cx, Field, Icon, inputCls, Spinner } from '../components/ui';
import { tl } from '../i18n';
import { Shell } from './Plan';

/**
 * Notis blast workspace (Collections): upload the month's masterlist, every row is checked,
 * then download the letters or Outlook drafts for the batch (or send directly once set up).
 */
interface Access { use: boolean; send: boolean; directSending: boolean; me: string }
interface BatchSummary { id: string; name: string; source_file: string; notice_date: string; created_at: string; purged_at: string | null; created_by: string | null; total: number; included: number; sent: number; drafted: number }
interface Row {
  id: string;
  row_no: number;
  state: 'ready' | 'held' | 'no_email' | 'incomplete';
  included: boolean;
  account_number: string | null;
  customer_name: string | null;
  email: string | null;
  reasons: string[];
  warnings: string[];
  delivery: 'queued' | 'sent' | 'failed' | null;
  delivery_error: string | null;
  months: string | null;
  overdue: number | null;
  amount: number | null;
}
interface Batch { id: string; name: string; source_file: string; sheet: string | null; notice_date: string; as_of_default: string | null; created_by: string; purged_at: string | null }

const STATE: Record<Row['state'], { label: string; tone: 'green' | 'amber' | 'red' | 'neutral' }> = {
  ready: { label: 'Ready', tone: 'green' },
  held: { label: 'Held by Finance', tone: 'neutral' },
  no_email: { label: 'No valid email', tone: 'red' },
  incomplete: { label: 'Incomplete data', tone: 'red' },
};
const rm = (n: number | null) => (n == null ? '' : `RM ${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

async function download(path: string, fallbackName: string) {
  const res = await fetch(path, { credentials: 'same-origin' });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `Download failed (${res.status})`);
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await res.blob());
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

export default function NotisPage() {
  const { id } = useParams();
  const [access, setAccess] = useState<Access | null>(null);
  useEffect(() => void api<Access>('/api/notis/access').then(setAccess).catch(() => setAccess({ use: false, send: false, directSending: false, me: '' })), []);
  return (
    <Shell title={tl('Notis blast')} back={id ? '/notis' : '/'}>
      {!access ? (
        <Spinner />
      ) : !access.use ? (
        <p className="rounded-lg bg-ink-50 p-4 text-sm text-ink-600">{tl('The notis blast workspace is for Collections. Ask an admin for access.')}</p>
      ) : id ? (
        <BatchView id={id} access={access} />
      ) : (
        <Batches />
      )}
    </Shell>
  );
}

function Batches() {
  const navigate = useNavigate();
  const [list, setList] = useState<BatchSummary[] | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [noticeDate, setNoticeDate] = useState(() => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10));
  const [sheets, setSheets] = useState<string[]>([]);
  const [sheet, setSheet] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => void api<BatchSummary[]>('/api/notis/batches').then(setList).catch(() => setList([])), []);

  async function upload() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('noticeDate', noticeDate);
      if (sheet) form.append('sheet', sheet);
      form.append('file', file);
      const res = await fetch('/api/notis/batches', { method: 'POST', body: form, credentials: 'same-origin' });
      const data = await res.json();
      if (!res.ok) {
        if (data.sheets?.length) setSheets(data.sheets);
        throw new Error(data.error ?? 'Upload failed');
      }
      navigate(`/notis/${data.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <section className="rounded-xl border border-ink-100 bg-white p-4 shadow-sm md:p-5">
        <h2 className="text-base font-semibold">{tl('New batch: Notis Potongan Gaji Tidak Berjaya')}</h2>
        <p className="mt-1 text-xs text-ink-500">
          {tl('Upload the month\'s masterlist from SharePoint as it is (the "MISS DEDUCTION EMAIL" sheet is read). Every row is checked first; rows with a remark from Finance are held, rows without a valid email or arrears months are skipped. Nothing is sent until you choose to.')}
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Field label={tl('Masterlist (.xlsx)')}>
            <input
              type="file"
              accept=".xlsx,.csv"
              className="block w-full text-sm"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setSheets([]);
                setSheet('');
              }}
            />
          </Field>
          <Field label={tl('Date on the letters')}>
            <input type="date" className={inputCls} value={noticeDate} onChange={(e) => setNoticeDate(e.target.value)} />
          </Field>
          {sheets.length > 0 && (
            <Field label={tl('Sheet with the customer list')}>
              <select className={inputCls} value={sheet} onChange={(e) => setSheet(e.target.value)}>
                <option value="">{tl('Choose…')}</option>
                {sheets.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </Field>
          )}
        </div>
        <Button className="mt-3" variant="primary" disabled={!file || busy || (sheets.length > 0 && !sheet)} onClick={upload}>
          {busy ? <Spinner /> : <Icon name="plus" className="h-4 w-4" />} {tl('Check the list')}
        </Button>
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </section>

      <section className="rounded-xl border border-ink-100 bg-white p-4 shadow-sm md:p-5">
        <h2 className="text-base font-semibold">{tl('Batches')}</h2>
        {!list ? (
          <Spinner />
        ) : list.length === 0 ? (
          <p className="mt-2 text-sm text-ink-500">{tl('No batches yet.')}</p>
        ) : (
          <ul className="mt-2 divide-y divide-ink-100">
            {list.map((b) => (
              <li key={b.id}>
                <Link to={`/notis/${b.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5 hover:bg-ink-50">
                  <span>
                    <span className="font-medium">{b.name}</span>
                    <span className="ml-2 text-xs text-ink-500">{b.source_file} · {b.created_by} · {new Date(b.created_at).toLocaleDateString()}</span>
                  </span>
                  <span className="flex gap-1.5">
                    <Badge tone="green">{tl('{n} to send', { n: b.included })}</Badge>
                    {b.drafted > 0 && <Badge tone="blue">{tl('Drafts downloaded')}</Badge>}
                    {b.sent > 0 && <Badge tone="blue">{tl('{n} sent', { n: b.sent })}</Badge>}
                    {b.purged_at && <Badge>{tl('Customer details removed')}</Badge>}
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

type Filter = 'all' | Row['state'] | 'warnings' | 'excluded';

function BatchView({ id, access }: { id: string; access: Access }) {
  const navigate = useNavigate();
  const [data, setData] = useState<{ batch: Batch; rows: Row[] } | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [emailDraft, setEmailDraft] = useState('');
  const [confirm, setConfirm] = useState('');
  const load = () => api<{ batch: Batch; rows: Row[] }>(`/api/notis/batches/${id}`).then(setData).catch((e) => setError(e.message));
  useEffect(() => void load(), [id]);
  // While notices are going out, refresh every few seconds.
  useEffect(() => {
    if (!data?.rows.some((r) => r.delivery === 'queued')) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [data]);

  const counts = useMemo(() => {
    const rows = data?.rows ?? [];
    return {
      ready: rows.filter((r) => r.state === 'ready' && r.included).length,
      held: rows.filter((r) => r.state === 'held').length,
      no_email: rows.filter((r) => r.state === 'no_email').length,
      incomplete: rows.filter((r) => r.state === 'incomplete').length,
      warnings: rows.filter((r) => r.state === 'ready' && r.warnings.length).length,
      excluded: rows.filter((r) => r.state === 'ready' && !r.included).length,
      sent: rows.filter((r) => r.delivery === 'sent').length,
      queued: rows.filter((r) => r.delivery === 'queued').length,
      failed: rows.filter((r) => r.delivery === 'failed').length,
    };
  }, [data]);

  if (error && !data) return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>;
  if (!data) return <Spinner />;
  const { batch, rows } = data;
  const purged = !!batch.purged_at;
  const shown = rows.filter((r) =>
    filter === 'all' ? true : filter === 'warnings' ? r.state === 'ready' && r.warnings.length > 0 : filter === 'excluded' ? r.state === 'ready' && !r.included : r.state === filter,
  );

  const run = async (key: string, fn: () => Promise<void>) => {
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
  const patch = (row: Row, body: { included?: boolean; email?: string }) =>
    run(`row-${row.id}`, async () => {
      await api(`/api/notis/rows/${row.id}`, { method: 'PATCH', body });
      setEditing(null);
      await load();
    });

  const tile = (label: string, value: number, f: Filter, tone = '') => (
    <button onClick={() => setFilter(filter === f ? 'all' : f)} className={cx('rounded-lg p-3 text-left', filter === f ? 'bg-accent-50 ring-1 ring-accent-300' : 'bg-ink-50 hover:bg-ink-100')}>
      <p className="text-xs text-ink-500">{tl(label)}</p>
      <p className={cx('text-lg font-semibold tabular-nums', tone)}>{value}</p>
    </button>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <section className="rounded-xl border border-ink-100 bg-white p-4 shadow-sm md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold">{batch.name}</h2>
            <p className="text-xs text-ink-500">
              {batch.source_file}
              {batch.sheet ? ` → "${batch.sheet}"` : ''} · {tl('Letter date')}: {batch.notice_date}
              {batch.as_of_default ? ` · ${tl('Records as of')}: ${batch.as_of_default}` : ''}
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              confirmDelete() &&
              run('delete', async () => {
                await api(`/api/notis/batches/${id}`, { method: 'DELETE' });
                navigate('/notis');
              })
            }
          >
            <Icon name="trash" className="h-3.5 w-3.5" /> {tl('Delete batch')}
          </Button>
        </div>
        {purged && <p className="mt-3 rounded-lg bg-ink-50 px-3 py-2 text-sm text-ink-600">{tl('Customer details in this batch have been removed (retention period). The send log is kept.')}</p>}
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-6">
          {tile('To send', counts.ready, 'ready', 'text-emerald-700')}
          {tile('Check first', counts.warnings, 'warnings', counts.warnings ? 'text-amber-700' : '')}
          {tile('Held by Finance', counts.held, 'held')}
          {tile('No valid email', counts.no_email, 'no_email', counts.no_email ? 'text-red-700' : '')}
          {tile('Incomplete data', counts.incomplete, 'incomplete', counts.incomplete ? 'text-red-700' : '')}
          {tile('Excluded by you', counts.excluded, 'excluded')}
        </div>
      </section>

      <section className="rounded-xl border border-ink-100 bg-white p-4 shadow-sm md:p-5">
        <h2 className="text-base font-semibold">{tl('Send this batch')}</h2>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-ink-100 p-3">
            <p className="text-sm font-medium">{tl('1. Outlook drafts (recommended)')}</p>
            <p className="mt-1 text-xs text-ink-500">
              {tl('A zip with one email per customer, addressed, with the letter attached. Double-click each file: Outlook opens it ready to check and Send. Also includes the list of customers not sent, for follow-up.')}
            </p>
            <Button className="mt-2" variant="primary" disabled={!counts.ready || purged || busy !== null} onClick={() => run('drafts', async () => { await download(`/api/notis/batches/${id}/drafts.zip`, 'drafts.zip'); await load(); })}>
              {busy === 'drafts' ? <Spinner /> : <Icon name="download" className="h-4 w-4" />} {tl('Download {n} Outlook drafts', { n: counts.ready })}
            </Button>
            <Button className="ml-2 mt-2" disabled={!counts.ready || purged || busy !== null} onClick={() => run('pdfs', () => download(`/api/notis/batches/${id}/letters.zip`, 'letters.zip'))}>
              {busy === 'pdfs' ? <Spinner /> : null} {tl('Letters only (PDF zip)')}
            </Button>
          </div>
          <div className="rounded-lg border border-ink-100 p-3">
            <p className="text-sm font-medium">{tl('2. Send directly from the Council')}</p>
            {!access.directSending ? (
              <p className="mt-1 text-xs text-ink-500">{tl('Not set up yet: IT needs to connect the Collections mailbox. Until then use Outlook drafts.')}</p>
            ) : (
              <>
                <p className="mt-1 text-xs text-ink-500">{tl('Send yourself a test copy first. Sending to customers needs a Collections lead; notices go out a few per minute and every send is logged.')}</p>
                <Button size="sm" className="mt-2" disabled={!counts.ready || purged || busy !== null} onClick={() => run('test', async () => { const r = await api<{ sent: number; to: string }>(`/api/notis/batches/${id}/test`, { body: { count: 1 } }); setNote(tl('Test copy sent to {to}.', { to: r.to })); })}>
                  {tl('Send me a test copy')}
                </Button>
                {access.send && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <input className={cx(inputCls, 'w-28')} placeholder="SEND" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label={tl('Type SEND to confirm')} />
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={confirm !== 'SEND' || !counts.ready || purged || busy !== null}
                      onClick={() => run('send', async () => { const r = await api<{ queued: number }>(`/api/notis/batches/${id}/send`, { body: { confirm } }); setConfirm(''); setNote(tl('{n} notices are being sent.', { n: r.queued })); await load(); })}
                    >
                      {tl('Send {n} notices to customers', { n: counts.ready - counts.sent })}
                    </Button>
                    <span className="text-xs text-ink-500">{tl('Type SEND to confirm')}</span>
                  </div>
                )}
              </>
            )}
            {(counts.sent > 0 || counts.queued > 0 || counts.failed > 0) && (
              <p className="mt-2 text-xs text-ink-600">
                {tl('Sent')}: {counts.sent} · {tl('Waiting')}: {counts.queued} · {tl('Failed')}: {counts.failed}
              </p>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
          <button className="font-medium text-accent-700 hover:underline" onClick={() => run('log', () => download(`/api/notis/batches/${id}/log.csv`, 'log.csv'))}>
            {tl('Download send log (CSV)')}
          </button>
        </div>
        {note && <p className="mt-3 rounded-lg bg-accent-50 px-3 py-2 text-sm text-accent-800">{note}</p>}
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </section>

      <section className="rounded-xl border border-ink-100 bg-white p-4 shadow-sm md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">{tl('Customers')} ({shown.length})</h2>
          {filter !== 'all' && (
            <button className="text-xs font-medium text-accent-700 hover:underline" onClick={() => setFilter('all')}>
              {tl('Show all')}
            </button>
          )}
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-500">
                <th className="py-1 pr-2">{tl('Send')}</th>
                <th className="py-1 pr-2">{tl('Row')}</th>
                <th className="py-1 pr-2">{tl('Customer')}</th>
                <th className="py-1 pr-2">{tl('Email')}</th>
                <th className="py-1 pr-2">{tl('Months in arrears')}</th>
                <th className="py-1 pr-2 text-right">{tl('Amount')}</th>
                <th className="py-1 pr-2">{tl('Status')}</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className={cx('border-t border-ink-100 align-top', r.state !== 'ready' && 'text-ink-500')}>
                  <td className="py-2 pr-2">
                    <input
                      type="checkbox"
                      className="accent-accent-600"
                      checked={r.state === 'ready' && r.included}
                      disabled={r.state !== 'ready' || purged || r.delivery === 'sent' || r.delivery === 'queued' || busy !== null}
                      onChange={(e) => patch(r, { included: e.target.checked })}
                      aria-label={tl('Include')}
                    />
                  </td>
                  <td className="py-2 pr-2 tabular-nums">{r.row_no}</td>
                  <td className="py-2 pr-2">
                    <p className="font-medium text-ink-900">{r.customer_name}</p>
                    <p className="font-mono text-xs">{r.account_number}</p>
                  </td>
                  <td className="py-2 pr-2">
                    {editing === r.id ? (
                      <span className="flex gap-1">
                        <input className={cx(inputCls, 'py-1 text-xs')} value={emailDraft} onChange={(e) => setEmailDraft(e.target.value)} autoFocus />
                        <Button size="sm" onClick={() => patch(r, { email: emailDraft })}>{tl('Save')}</Button>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <span className="break-all">{r.email ?? '—'}</span>
                        {!purged && r.delivery !== 'sent' && r.delivery !== 'queued' && (r.state === 'ready' || r.state === 'no_email') && (
                          <button className="text-ink-400 hover:text-ink-700" title={tl('Edit email')} onClick={() => { setEditing(r.id); setEmailDraft(r.email ?? ''); }}>
                            <Icon name="edit" className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-2">
                    {r.months}
                    {r.overdue != null && <span className="text-xs text-ink-500"> ({r.overdue})</span>}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">{rm(r.amount)}</td>
                  <td className="py-2 pr-2">
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={STATE[r.state].tone}>{tl(STATE[r.state].label)}</Badge>
                      {r.state === 'ready' && !r.included && <Badge>{tl('Excluded')}</Badge>}
                      {r.delivery === 'sent' && <Badge tone="blue">{tl('Sent')}</Badge>}
                      {r.delivery === 'queued' && <Badge tone="blue">{tl('Sending…')}</Badge>}
                      {r.delivery === 'failed' && <Badge tone="red" title={r.delivery_error ?? ''}>{tl('Failed')}</Badge>}
                    </div>
                    {[...r.reasons].map((x) => (
                      <p key={x} className="mt-1 text-xs text-red-700">{x}</p>
                    ))}
                    {r.warnings.map((x) => (
                      <p key={x} className="mt-1 text-xs text-amber-700">⚠ {x}</p>
                    ))}
                  </td>
                  <td className="py-2 text-right">
                    {!purged && r.state !== 'incomplete' && (
                      <a href={`/api/notis/rows/${r.id}/letter.pdf`} target="_blank" rel="noreferrer" className="text-xs font-medium text-accent-700 hover:underline">
                        {tl('Preview letter')}
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

const confirmDelete = () => window.confirm(tl('Delete this batch? The send log is kept.'));
