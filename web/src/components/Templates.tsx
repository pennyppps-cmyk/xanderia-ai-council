import { useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../auth';
import { getLang, tl } from '../i18n';
import { Button, cx, Field, Icon, inputCls, Spinner } from './ui';

export interface TemplateField {
  key: string;
  label: string;
  label_ms?: string;
  placeholder?: string;
  multiline?: boolean;
  required?: boolean;
}

export interface CouncilTemplate {
  key: string;
  title: string;
  title_ms: string | null;
  description: string | null;
  description_ms: string | null;
  mode: 'council' | 'quick' | 'check';
  department_slug: string | null;
  fields: TemplateField[];
}

export const tTitle = (t: CouncilTemplate) => (getLang() === 'ms' && t.title_ms) || t.title;
const tDesc = (t: CouncilTemplate) => (getLang() === 'ms' && t.description_ms) || t.description || '';
const fLabel = (f: TemplateField) => (getLang() === 'ms' && f.label_ms) || f.label;

const MODE_BADGE: Record<string, string> = { council: 'Council', quick: 'Quick', check: 'Check' };

/** Grid of template cards (home screen and picker). */
export function TemplateGrid({ templates, onPick, compact = false }: { templates: CouncilTemplate[]; onPick(t: CouncilTemplate): void; compact?: boolean }) {
  return (
    <div className={cx('grid gap-2 text-left', compact ? 'sm:grid-cols-2' : 'sm:grid-cols-3')}>
      {templates.map((t) => (
        <button key={t.key} onClick={() => onPick(t)} className="rounded-xl border border-ink-100 bg-white p-3 text-sm shadow-sm hover:border-accent-500">
          <span className="mb-1 block text-[11px] font-semibold tracking-wide text-accent-700 uppercase">{tl(MODE_BADGE[t.mode])}</span>
          <span className="block font-medium text-ink-900">{tTitle(t)}</span>
          <span className="mt-0.5 block text-xs text-ink-600">{tDesc(t)}</span>
        </button>
      ))}
    </div>
  );
}

/** Modal: pick a template (if none chosen yet), fill its fields, send. */
export function TemplateDialog({
  templates,
  initial,
  onClose,
  onSubmit,
}: {
  templates: CouncilTemplate[];
  initial: CouncilTemplate | null;
  onClose(): void;
  onSubmit(t: CouncilTemplate, content: string, departmentId?: string): Promise<void>;
}) {
  const { departments } = useAuth();
  const [chosen, setChosen] = useState<CouncilTemplate | null>(initial);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!chosen) return;
    const missing = chosen.fields.filter((f) => f.required && !values[f.key]?.trim());
    if (missing.length) return setError(tl('Please fill in: {fields}', { fields: missing.map(fLabel).join(', ') }));
    // The filled form becomes the question, so the conversation shows exactly what was asked.
    const lines = chosen.fields
      .filter((f) => values[f.key]?.trim())
      .map((f) => (f.multiline ? `**${f.label}:**\n${values[f.key].trim()}` : `**${f.label}:** ${values[f.key].trim()}`));
    const content = `**${chosen.title}**\n\n${lines.join('\n\n')}`;
    const dept = chosen.department_slug ? departments.find((d) => d.slug === chosen.department_slug)?.id : undefined;
    setBusy(true);
    try {
      await onSubmit(chosen, content, dept);
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  // Portal: the composer bar uses backdrop-blur, which would trap a fixed overlay inside it.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3">
          <h2 className="text-sm font-semibold">{chosen ? tTitle(chosen) : tl('Start from a template')}</h2>
          <button onClick={onClose} aria-label={tl('Close')} className="rounded p-1 text-ink-400 hover:bg-ink-100">
            <Icon name="close" />
          </button>
        </div>
        {!chosen ? (
          <div className="p-5">
            <TemplateGrid templates={templates} onPick={setChosen} compact />
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3 p-5">
            <p className="text-xs text-ink-400">{tDesc(chosen)}</p>
            {chosen.fields.map((f) => (
              <Field key={f.key} label={`${fLabel(f)}${f.required ? ' *' : ''}`}>
                {f.multiline ? (
                  <textarea
                    className={cx(inputCls, 'min-h-24')}
                    placeholder={f.placeholder}
                    value={values[f.key] ?? ''}
                    onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                  />
                ) : (
                  <input className={inputCls} placeholder={f.placeholder} value={values[f.key] ?? ''} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
                )}
              </Field>
            ))}
            {chosen.department_slug && (
              <p className="text-xs text-ink-400">
                {tl('Answered by the {dept} advisor.', { dept: departments.find((d) => d.slug === chosen.department_slug)?.name ?? chosen.department_slug })}
              </p>
            )}
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <div className="flex justify-between gap-2 pt-1">
              {!initial ? (
                <Button type="button" size="sm" variant="ghost" onClick={() => setChosen(null)}>
                  {tl('All templates')}
                </Button>
              ) : (
                <span />
              )}
              <Button variant="primary" disabled={busy}>
                {busy && <Spinner />} {chosen.mode === 'council' ? tl('Ask the council') : chosen.mode === 'check' ? tl('Check it') : tl('Draft it')}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
