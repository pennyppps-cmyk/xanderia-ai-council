import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useAuth } from '../auth';
import type { Mode } from '../types';
import { cx, Icon, Spinner } from './ui';
import { getLang, tl } from '../i18n';
import { MicButton } from './Channels';


export interface ComposerHandle {
  /** Prefill the box (and optionally switch mode), e.g. for follow-ups or answering the council. */
  setText(text: string, mode?: Mode): void;
}

interface Props {
  busy: boolean;
  defaultDepartmentId?: string;
  /** Shown instead of the default placeholder, e.g. while the council waits for answers. */
  placeholder?: string;
  onSend(input: { content: string; mode: Mode; departmentId: string; peerReview: boolean }): Promise<void>;
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
    const content = text.trim();
    if (!content || busy) return;
    await onSend({ content, mode: effectiveMode, departmentId, peerReview: effectiveMode !== 'quick' && peerReview });
    setText('');
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
            title={tl("Advisors anonymously critique each other before the Chairman decides. Adds about a minute.")}
          >
            <input
              type="checkbox"
              checked={peerReview}
              onChange={(e) => setPeerReview(e.target.checked)}
              className="accent-accent-600"
            />
            {tl("Peer review")}
          </label>
        )}

        <span className="ml-auto" />
        <MicButton
          onText={(t) => {
            setText((cur) => (cur.trim() ? `${cur.trimEnd()} ${t}` : t));
            requestAnimationFrame(() => area.current?.focus());
          }}
        />
        <button
          onClick={submit}
          disabled={!text.trim() || busy}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-ink-900 text-white hover:bg-ink-800 disabled:opacity-30"
          aria-label={tl("Send")}
        >
          {busy ? <Spinner /> : <Icon name="send" />}
        </button>
      </div>
    </div>
  );
});
