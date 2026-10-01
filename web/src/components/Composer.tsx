import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useCouncilView } from './CouncilRoom';
import { useAuth } from '../auth';
import type { Mode } from '../types';
import { cx, Icon, Spinner } from './ui';
import { getLang, tl } from '../i18n';
import { MicButton } from './Channels';
import { api } from '../api';

interface AttachedFile {
  key: string;
  name: string;
  id?: string;
  chars?: number;
  checkedAs?: string | null; // read and checked by the Document Extractor (payslip, bank statement...)
  status: 'uploading' | 'ready';
}


export interface ComposerHandle {
  /** Prefill the box (and optionally switch mode), e.g. for follow-ups or answering the council. */
  setText(text: string, mode?: Mode): void;
}

interface Props {
  busy: boolean;
  defaultDepartmentId?: string;
  /** Shown instead of the default placeholder, e.g. while the council waits for answers. */
  placeholder?: string;
  onSend(input: { content: string; mode: Mode; departmentId: string; peerReview: boolean; watchRoom?: boolean; attachmentIds?: string[] }): Promise<void>;
  /** Opens the template picker. */
  onTemplates?(): void;
}

const MODES: Array<{ key: Mode; label: string; hint: string }> = [
  { key: 'auto', label: 'Auto', hint: 'The router picks Quick or Council for you' },
  { key: 'quick', label: 'Quick', hint: 'One department advisor, fast answer' },
  { key: 'council', label: 'Council', hint: 'Six advisors debate, the Chairman decides (≈1–2 min)' },
];

export const Composer = forwardRef<ComposerHandle, Props>(function Composer({ busy, defaultDepartmentId, placeholder, onSend, onTemplates }, ref) {
  const { me, departments } = useAuth();
  const [text, setText] = useState('');
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem('xc:mode') as Mode) || 'auto');
  const [departmentId, setDepartmentId] = useState(defaultDepartmentId ?? me?.user.department_id ?? '');
  const [peerReview, setPeerReview] = useState(false);
  const roomView = useCouncilView() === 'room';
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploading = files.some((f) => f.status === 'uploading');

  async function attach(list: FileList | null) {
    setFileError(null);
    for (const file of Array.from(list ?? [])) {
      if (files.length >= 3) {
        setFileError(tl('Up to 3 documents per question.'));
        break;
      }
      const key = `${file.name}-${Date.now()}`;
      setFiles((all) => [...all, { key, name: file.name, status: 'uploading' }]);
      try {
        const form = new FormData();
        form.append('file', file);
        const r = await api<{ id: string; filename: string; chars: number; checkedAs?: string | null }>('/api/attachments', { form });
        setFiles((all) => all.map((f) => (f.key === key ? { ...f, id: r.id, chars: r.chars, checkedAs: r.checkedAs, status: 'ready' } : f)));
      } catch (err) {
        setFiles((all) => all.filter((f) => f.key !== key));
        setFileError(`${file.name}: ${(err as Error).message}`);
      }
    }
    if (fileInput.current) fileInput.current.value = '';
  }
  const area = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
    setText(t: string, m?: Mode) {
      setText(t);
      if (m) setMode(m);
      requestAnimationFrame(() => {
        area.current?.focus();
        area.current?.setSelectionRange(t.length, t.length);
      });
    },
  }));

  useEffect(() => {
    if (defaultDepartmentId) setDepartmentId(defaultDepartmentId);
  }, [defaultDepartmentId]);

  useEffect(() => {
    try {
      localStorage.setItem('xc:mode', mode);
    } catch {}
  }, [mode]);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  const effectiveMode: Mode = mode === 'council' && !me?.canUseCouncil ? 'auto' : mode;

  async function submit() {
    const ready = files.filter((f) => f.status === 'ready' && f.id);
    // A document with no words needs a default request.
    const content = text.trim() || (ready.length ? tl('Please review the attached document and judge the plan in it.') : '');
    if (!content || busy || uploading) return;
    await onSend({
      content,
      mode: effectiveMode,
      departmentId,
      peerReview: effectiveMode !== 'quick' && peerReview,
      // Watching in the council room: the council runs the peer review so there is an argument to watch.
      watchRoom: effectiveMode !== 'quick' && roomView,
      attachmentIds: ready.length ? ready.map((f) => f.id!) : undefined,
    });
    setText('');
    setFiles([]);
    setFileError(null);
  }

  return (
    <div className="rounded-2xl border border-ink-200 bg-white shadow-sm focus-within:border-accent-600 focus-within:ring-2 focus-within:ring-accent-100">
      <textarea
        ref={area}
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void submit();
          }
        }}
        placeholder={placeholder ?? tl('Ask a question, or bring a plan or decision for the council… (English or Bahasa Malaysia)')}
        className="block w-full resize-none rounded-t-2xl bg-transparent px-4 pt-3 pb-1 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none"
      />
      {(files.length > 0 || fileError) && (
        <div className="flex flex-wrap items-center gap-1.5 px-3 pb-1">
          {files.map((f) => (
            <span key={f.key} className="inline-flex max-w-64 items-center gap-1 rounded-lg border border-ink-200 bg-ink-50 px-2 py-1 text-xs text-ink-700">
              {f.status === 'uploading' ? <Spinner /> : <Icon name="file" className="h-3.5 w-3.5 shrink-0" />}
              <span className="truncate" title={f.name}>{f.name}</span>
              {f.checkedAs ? (
                <span className="shrink-0 text-emerald-700" title={tl('Read and checked by the Document Extractor')}>
                  · {tl('Checked: {kind}', { kind: f.checkedAs })}
                </span>
              ) : (
                f.chars != null && <span className="shrink-0 text-ink-400">· {tl('{n} words', { n: Math.round(f.chars / 6).toLocaleString() })}</span>
              )}
              {f.status === 'ready' && (
                <button
                  type="button"
                  aria-label={tl('Remove {name}', { name: f.name })}
                  className="ml-0.5 rounded p-0.5 text-ink-400 hover:bg-ink-200 hover:text-ink-900"
                  onClick={() => {
                    setFiles((all) => all.filter((x) => x.key !== f.key));
                    if (f.id) void api(`/api/attachments/${f.id}`, { method: 'DELETE' }).catch(() => {});
                  }}
                >
                  <Icon name="close" className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
          {fileError && <span className="text-xs text-red-700">{fileError}</span>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 px-3 pb-2">
        <div className="inline-flex rounded-lg bg-ink-100 p-0.5" role="radiogroup" aria-label={tl("Mode")}>
          {MODES.map((m) => {
            const disabled = m.key === 'council' && !me?.canUseCouncil;
            return (
              <button
                key={m.key}
                role="radio"
                aria-checked={effectiveMode === m.key}
                title={disabled ? tl('Council mode is not enabled for your role yet') : tl(m.hint)}
                disabled={disabled}
                onClick={() => setMode(m.key)}
                className={cx(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-40',
                  effectiveMode === m.key ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-600 hover:text-ink-900',
                )}
              >
                {tl(m.label)}
              </button>
            );
          })}
        </div>

        <select
          value={departmentId}
          onChange={(e) => setDepartmentId(e.target.value)}
          title={tl("Which department's advisor should answer")}
          className="max-w-44 rounded-lg border border-ink-200 bg-white px-2 py-1 text-xs text-ink-700 focus:border-accent-600 focus:outline-none"
        >
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {(getLang() === 'ms' && d.name_ms) || d.name}{d.id === me?.user.department_id ? ` (${tl('mine')})` : ''}
            </option>
          ))}
        </select>

        {onTemplates && (
          <button
            type="button"
            onClick={onTemplates}
            className="inline-flex items-center gap-1 rounded-lg border border-ink-200 px-2 py-1 text-xs font-medium text-ink-700 hover:bg-ink-50"
            title={tl('Guided starters that ask for the facts the council needs')}
          >
            <Icon name="plus" className="h-3 w-3" /> {tl('Templates')}
          </button>
        )}

        {effectiveMode !== 'quick' && (
          <label
            className="inline-flex items-center gap-1.5 text-xs text-ink-600"
            title={
              roomView
                ? tl('On while the Council room view is on, so you can watch the advisors review each other.')
                : tl('Advisors anonymously critique each other before the Chairman decides. Adds about two minutes.')
            }
          >
            <input
              type="checkbox"
              checked={peerReview || roomView}
              disabled={roomView}
              onChange={(e) => setPeerReview(e.target.checked)}
              className="accent-accent-600"
            />
            {tl("Peer review")}
          </label>
        )}

        <span className="ml-auto" />
        <input
          ref={fileInput}
          type="file"
          multiple
          accept=".pdf,.docx,.xlsx,.txt,.md,.csv,.jpg,.jpeg,.png,.tif,.tiff,.webp"
          className="sr-only"
          onChange={(e) => void attach(e.target.files)}
        />
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={files.length >= 3}
          title={tl('Attach a plan or document for the council to judge (PDF, Word, Excel, text; up to 3)')}
          aria-label={tl('Attach a document')}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-ink-200 text-ink-600 hover:bg-ink-50 disabled:opacity-40"
        >
          <Icon name="clip" className="h-4 w-4" />
        </button>
        <MicButton
          onText={(t) => {
            setText((cur) => (cur.trim() ? `${cur.trimEnd()} ${t}` : t));
            requestAnimationFrame(() => area.current?.focus());
          }}
        />
        <button
          onClick={submit}
          disabled={(!text.trim() && !files.some((f) => f.status === 'ready')) || busy || uploading}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-ink-900 text-white hover:bg-ink-800 disabled:opacity-30"
          aria-label={tl("Send")}
        >
          {busy ? <Spinner /> : <Icon name="send" />}
        </button>
      </div>
    </div>
  );
});
