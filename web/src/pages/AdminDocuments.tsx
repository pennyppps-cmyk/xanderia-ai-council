import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import { Button, cx, Field, FilePicker, Icon, inputCls, Spinner } from '../components/ui';
import { dateLocale, tl } from '../i18n';

type Kind = 'write' | 'risks' | 'action_plan' | 'signoff';
interface OutlineSection {
  key: string;
  heading: string;
  kind: Kind;
  guide: string;
}
interface LangOutline {
  title: string;
  sections: OutlineSection[];
}
interface DocOutline {
  name: string;
  ref_code: string;
  numbered: boolean;
  en: LangOutline;
  ms: LangOutline;
}
type Outlines = Record<'exec_brief' | 'board_paper', DocOutline>;
interface Settings {
  letterhead: { fileName: string; uploadedAt?: string; custom: boolean };
  footer: { en: string; ms: string };
  outlines: Outlines;
}

const KIND_LABEL: Record<Kind, string> = {
  write: 'Written from the verdict',
  risks: 'Risk table (from the verdict)',
  action_plan: 'Action plan table (from the verdict)',
  signoff: 'Sign-off block',
};

function Card({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-xl border border-ink-100 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="flex-1 text-sm font-semibold">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Admin → Documents: the letterhead, the footer and the outline of each document type. */
export default function DocumentsAdmin() {
  const [s, setS] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api<Settings>('/api/admin/documents/settings').then(setS).catch((e) => setError((e as Error).message));
  }, []);
  useEffect(load, [load]);
  if (!s) return error ? <p className="text-sm text-red-700">{error}</p> : <Spinner />;
  return (
    <div className="space-y-4">
      <Letterhead info={s.letterhead} onChanged={load} />
      <Footer footer={s.footer} />
      <OutlineEditor outlines={s.outlines} />
    </div>
  );
}

function Letterhead({ info, onChanged }: { info: Settings['letterhead']; onChanged(): void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function upload() {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    const form = new FormData();
    form.append('file', file);
    try {
      await api('/api/admin/documents/letterhead', { form });
      setMsg({ ok: true, text: tl('Letterhead updated. Download a sample to check the layout.') });
      setFile(null);
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card
      title={tl('Letterhead')}
      actions={
        <a href="/api/admin/documents/sample.docx" download className="inline-flex items-center gap-1 text-xs font-medium text-accent-700 hover:underline">
          <Icon name="download" className="h-3.5 w-3.5" /> {tl('Download a sample')}
        </a>
      }
    >
      <p className="mb-3 text-sm text-ink-600">
        {tl('Every document is built on this Word file: its header, logo and fonts are kept as they are, the page is set to A4 and the body and footer are added.')}
      </p>
      <p className="mb-3 text-sm">
        <span className="text-ink-500">{tl('In use:')}</span> <strong>{info.custom ? info.fileName : tl('The shipped Xanderia Berhad letterhead')}</strong>
        {info.uploadedAt && <span className="text-ink-400"> · {new Date(info.uploadedAt).toLocaleDateString(dateLocale())}</span>}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-full max-w-sm"><FilePicker accept={['.docx']} file={file} onChange={setFile} /></div>
        <Button size="sm" variant="primary" disabled={!file || busy} onClick={upload}>
          {busy && <Spinner />} {tl('Upload letterhead')}
        </Button>
        {info.custom && (
          <Button
            size="sm"
            disabled={busy}
            onClick={async () => {
              if (!confirm(tl('Go back to the shipped letterhead?'))) return;
              await api('/api/admin/documents/letterhead', { method: 'DELETE' });
              onChanged();
            }}
          >
            {tl('Use the shipped letterhead')}
          </Button>
        )}
      </div>
      {msg && <p className={cx('mt-2 text-sm', msg.ok ? 'text-emerald-700' : 'text-red-700')}>{msg.text}</p>}
    </Card>
  );
}

function Footer({ footer }: { footer: Settings['footer'] }) {
  const [f, setF] = useState(footer);
  const [saved, setSaved] = useState(false);
  return (
    <Card title={tl('Footer')}>
      <p className="mb-3 text-sm text-ink-600">{tl('Printed at the bottom of every page, next to "Page X of Y".')}</p>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="English">
          <textarea className={cx(inputCls, 'min-h-20 text-sm')} maxLength={400} value={f.en} onChange={(e) => { setF({ ...f, en: e.target.value }); setSaved(false); }} />
        </Field>
        <Field label="Bahasa Malaysia">
          <textarea className={cx(inputCls, 'min-h-20 text-sm')} maxLength={400} value={f.ms} onChange={(e) => { setF({ ...f, ms: e.target.value }); setSaved(false); }} />
        </Field>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          disabled={!f.en.trim() || !f.ms.trim()}
          onClick={async () => {
            await api('/api/admin/documents/settings', { method: 'PUT', body: { footer: f } });
            setSaved(true);
          }}
        >
          {tl('Save footer')}
        </Button>
        {saved && <span className="text-xs text-emerald-700">{tl('Saved')}</span>}
      </div>
    </Card>
  );
}

function OutlineEditor({ outlines }: { outlines: Outlines }) {
  const [o, setO] = useState(outlines);
  const [type, setType] = useState<keyof Outlines>('exec_brief');
  const [lang, setLang] = useState<'en' | 'ms'>('en');
  const [state, setState] = useState<{ saved?: boolean; error?: string }>({});
  const doc = o[type];
  const lo = doc[lang];

  const setDoc = (patch: Partial<DocOutline>) => {
    setO({ ...o, [type]: { ...doc, ...patch } });
    setState({});
  };
  const setLo = (patch: Partial<LangOutline>) => setDoc({ [lang]: { ...lo, ...patch } } as Partial<DocOutline>);
  const setSection = (i: number, patch: Partial<OutlineSection>) => setLo({ sections: lo.sections.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const move = (i: number, by: number) => {
    const list = [...lo.sections];
    const [x] = list.splice(i, 1);
    list.splice(i + by, 0, x);
    setLo({ sections: list });
  };
  const newKey = () => {
    let n = lo.sections.length + 1;
    while (lo.sections.some((x) => x.key === `section_${n}`)) n++;
    return `section_${n}`;
  };

  return (
    <Card title={tl('Document outlines')}>
      <p className="mb-3 text-sm text-ink-600">
        {tl('The sections of each document, in order. Sections written from the verdict follow the instructions you give here; tables are filled in exactly from the verdict. Changes apply to documents drafted from now on.')}
      </p>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <select className={cx(inputCls, 'w-auto!')} value={type} onChange={(e) => setType(e.target.value as keyof Outlines)}>
          <option value="exec_brief">{tl('Executive brief')}</option>
          <option value="board_paper">{tl('Board paper')}</option>
        </select>
        <div className="inline-flex overflow-hidden rounded-lg border border-ink-200 text-sm">
          {(['en', 'ms'] as const).map((l) => (
            <button key={l} type="button" onClick={() => setLang(l)} className={cx('px-3 py-2', lang === l ? 'bg-ink-900 text-white' : 'bg-white hover:bg-ink-50')}>
              {l === 'en' ? 'English' : 'Bahasa Malaysia'}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Field label={tl('Title on the page')}>
          <input className={inputCls} value={lo.title} maxLength={80} onChange={(e) => setLo({ title: e.target.value })} />
        </Field>
        <Field label={tl('Reference code')} hint={tl('XB/{code}/2026/001', { code: doc.ref_code || '…' })}>
          <input className={inputCls} value={doc.ref_code} maxLength={10} onChange={(e) => setDoc({ ref_code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} />
        </Field>
        <label className="inline-flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" className="accent-accent-600" checked={doc.numbered} onChange={(e) => setDoc({ numbered: e.target.checked })} />
          {tl('Number the paragraphs (1.0, 1.1, 1.2)')}
        </label>
      </div>

      <ol className="space-y-2">
        {lo.sections.map((sec, i) => (
          <li key={sec.key} className="rounded-lg border border-ink-100 bg-ink-50 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-6 text-sm font-semibold text-ink-400">{i + 1}.</span>
              <input className={cx(inputCls, 'max-w-xs flex-1 py-1')} value={sec.heading} maxLength={120} onChange={(e) => setSection(i, { heading: e.target.value })} />
              <select className={cx(inputCls, 'w-auto! py-1 text-sm')} value={sec.kind} onChange={(e) => setSection(i, { kind: e.target.value as Kind })}>
                {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
                  <option key={k} value={k}>
                    {tl(KIND_LABEL[k])}
                  </option>
                ))}
              </select>
              <span className="ml-auto flex gap-1">
                <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)} title={tl('Move up')}>↑</Button>
                <Button size="sm" variant="ghost" disabled={i === lo.sections.length - 1} onClick={() => move(i, 1)} title={tl('Move down')}>↓</Button>
                <Button size="sm" variant="ghost" disabled={lo.sections.length <= 1} onClick={() => setLo({ sections: lo.sections.filter((_, j) => j !== i) })} title={tl('Remove')}>
                  <Icon name="trash" className="h-3.5 w-3.5" />
                </Button>
              </span>
            </div>
            {sec.kind === 'write' && (
              <textarea
                className={cx(inputCls, 'mt-2 min-h-16 text-sm')}
                maxLength={1500}
                value={sec.guide}
                placeholder={tl('What this section must contain and how long it should be')}
                onChange={(e) => setSection(i, { guide: e.target.value })}
              />
            )}
          </li>
        ))}
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={lo.sections.length >= 15} onClick={() => setLo({ sections: [...lo.sections, { key: newKey(), heading: tl('New section'), kind: 'write', guide: '' }] })}>
          <Icon name="plus" className="h-3.5 w-3.5" /> {tl('Add section')}
        </Button>
        <Button
          size="sm"
          variant="primary"
          onClick={async () => {
            try {
              await api('/api/admin/documents/settings', { method: 'PUT', body: { outlines: o } });
              setState({ saved: true });
            } catch (e) {
              setState({ error: (e as Error).message });
            }
          }}
        >
          {tl('Save outlines')}
        </Button>
        {state.saved && <span className="text-xs text-emerald-700">{tl('Saved')}</span>}
        {state.error && <span className="text-xs text-red-700">{state.error}</span>}
      </div>
    </Card>
  );
}
