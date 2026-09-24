import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import type { Citation, ClarifyRequest, Level, Message, Mode, PlanSummary, Stance, Verdict } from '../types';
import { useMessageStream, type LivePart, type LiveState } from '../useMessageStream';
import { Markdown } from './Markdown';
import { RecordDecision } from '../pages/Decisions';
import { Badge, Button, cx, Icon, Spinner, Typing } from './ui';
import { getLang, statusLabel, tl } from '../i18n';


interface Props {
  message: Message;
  onFinished(): void;
  onFollowUp(text: string, mode?: Mode): void;
  onRetry(): void;
  /** Answer the council's clarifying questions with "skip": it proceeds on its stated assumptions. */
  onSkipClarify(): void;
  /** Shared view: no actions, no follow-ups. */
  readOnly?: boolean;
  /** Re-run the council with one assumption changed. */
  onWhatIf?(change: string): Promise<void>;
  /** Ask for a document (SOP, policy, letter, memo) drafted from this answer. */
  onDraft?(request: string): void;
}

export function AssistantMessage({ message, onFinished, onFollowUp, onRetry, onSkipClarify, onWhatIf, onDraft, readOnly = false }: Props) {
  const live = useMessageStream(message, onFinished);
  const { departments } = useAuth();
  const dept = departments.find((d) => d.id === message.department_id);
  const mode = live.mode ?? (message.requested_mode === 'council' ? 'council' : message.requested_mode === 'quick' ? 'quick' : null);
  const finished = live.status === 'done';

  const text =
    mode === 'council'
      ? live.verdict
        ? message.content
        : (live.raw ?? '')
      : (live.parts.answer?.text ?? message.content);

  return (
    <div className="flex gap-3">
      <div className="mt-1 hidden h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink-900 sm:flex">
        <img src="/favicon.svg" alt="" className="h-8 w-8" />
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        <Header live={live} mode={mode} message={message} reviewFlag={Boolean(dept?.review_before_acting)} />

        {live.status === 'error' ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <p className="font-medium">{tl("This answer could not be completed.")}</p>
            <p className="mt-1 text-red-700">{live.error}</p>
            <Button size="sm" variant="danger" className="no-print mt-3" onClick={onRetry}>
              <Icon name="retry" /> {tl("Try again")}
            </Button>
          </div>
        ) : mode === 'clarify' && live.clarify ? (
          <ClarifyView clarify={live.clarify} onAnswer={onFollowUp} onSkip={onSkipClarify} />
        ) : mode === 'council' ? (
          <CouncilView live={live} message={message} onFollowUp={onFollowUp} />
        ) : (
          <QuickView live={live} text={text} />
        )}

        {live.citations.length > 0 && <Citations citations={live.citations} />}

        {!readOnly && finished && mode === 'council' && live.verdict && <PutIntoAction messageId={message.id} />}
        {!readOnly && finished && mode !== 'clarify' && (
          <Actions message={message} text={text} verdict={live.verdict} onFollowUp={onFollowUp} onWhatIf={onWhatIf} onDraft={onDraft} />
        )}
      </div>
    </div>
  );
}

function Header({ live, mode, message, reviewFlag }: { live: LiveState; mode: string | null; message: Message; reviewFlag: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-400">
      <span className="font-semibold text-ink-800">
        {mode === 'council' ? tl('Council') : mode === 'quick' ? tl('Quick answer') : mode === 'clarify' ? tl('Council · before it meets') : tl('Assistant')}
      </span>
      {live.router && (
        <span title={live.router.reason}>
          · {live.router.intent}
          {live.router.source === 'fallback' && ` (${tl('heuristic')})`}
        </span>
      )}
      {message.requested_mode === 'auto' && live.router && (
        <Badge tone="blue" title={tl("Mode chosen automatically by the router")}>{tl("auto →")} {live.router.suggested_mode}</Badge>
      )}
      {!message.cloud_used && (
        <Badge tone="green" title={tl("Every model call for this answer ran on Xanderia's own servers")}>
          <Icon name="shield" className="h-3 w-3" /> {tl("Processed on-premises")}
        </Badge>
      )}
      {live.router?.sensitivity === 'high' && <Badge tone="amber">{tl("Sensitive: kept local")}</Badge>}
      {live.router?.red_flag && live.router.red_flag !== 'none' && (
        <Badge tone="red" title={live.router.red_flag_reason || undefined}>
          {tl('Flagged for compliance review')}
        </Badge>
      )}
      {reviewFlag && <Badge tone="red">{tl("Review before acting")}</Badge>}
    </div>
  );
}

function QuickView({ live, text }: { live: LiveState; text: string }) {
  if (!text) return <Waiting live={live} />;
  return (
    <div className="rounded-2xl rounded-tl-sm border border-ink-100 bg-white px-4 py-3 shadow-sm">
      <Markdown text={text} />
      {live.status !== 'done' && <Typing />}
    </div>
  );
}

function Waiting({ live }: { live: LiveState }) {
  const label =
    live.status === 'queued' || live.position
      ? `${tl('Queued')}${live.position ? ` · ${tl('position {n}', { n: live.position })}` : ''}. ${tl('The model is busy with other requests.')}`
      : live.stage === 'router'
        ? tl('Reading your question…')
        : tl('Thinking…');
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-ink-100 bg-white px-4 py-3 text-sm text-ink-600 shadow-sm">
      <Spinner className="h-4 w-4 text-accent-600" /> {label}
    </div>
  );
}

// ── Council ──────────────────────────────────────────────────────────────────

const STAGES = [
  { key: 'router', label: 'Intake' },
  { key: 'stage1', label: 'Advisors' },
  { key: 'stage2', label: 'Peer review' },
  { key: 'stage3', label: 'Chairman' },
];

function ProgressStrip({ live, peerReview }: { live: LiveState; peerReview: boolean }) {
  const stages = STAGES.filter((s) => s.key !== 'stage2' || peerReview);
  const idx = live.status === 'done' ? stages.length : Math.max(0, stages.findIndex((s) => s.key === live.stage));
  const opinions = Object.values(live.parts).filter((p) => p.stage === 1);
  const reviews = Object.values(live.parts).filter((p) => p.stage === 2);
  const count = (parts: LivePart[]) => (parts.length ? ` ${parts.filter((p) => p.done).length}/${parts.length}` : '');
  return (
    <ol className="no-print flex flex-wrap items-center gap-1 text-xs">
      {stages.map((s, i) => {
        const state = i < idx ? 'done' : i === idx ? 'active' : 'todo';
        return (
          <li key={s.key} className="flex items-center gap-1">
            {i > 0 && <span className={cx('h-px w-4', state === 'todo' ? 'bg-ink-200' : 'bg-accent-500')} />}
            <span
              className={cx(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium',
                state === 'done' && 'bg-accent-50 text-accent-700',
                state === 'active' && 'bg-ink-900 text-white',
                state === 'todo' && 'bg-ink-100 text-ink-400',
              )}
            >
              {state === 'active' && <Spinner className="h-3 w-3" />}
              {tl(s.label)}
              {s.key === 'stage1' && count(opinions)}
              {s.key === 'stage2' && count(reviews)}
            </span>
          </li>
        );
      })}
      {live.position ? <span className="ml-2 text-ink-400">{tl("queued · position")} {live.position}</span> : null}
    </ol>
  );
}

function CouncilView({ live, message, onFollowUp }: { live: LiveState; message: Message; onFollowUp(text: string, mode?: Mode): void }) {
  const { personas } = useAuth();
  const opinions = Object.values(live.parts).filter((p) => p.stage === 1);
  const reviews = Object.values(live.parts).filter((p) => p.stage === 2);
  const chairman = live.parts.chairman;
  const name = (key: string) => (getLang() === 'ms' && personas[key]?.name_ms) || personas[key]?.name || key;
  const peerReview = Boolean(message.options?.peerReview) || reviews.length > 0;
  const running = live.status !== 'done';

  return (
    <div className="space-y-3">
      {running && <ProgressStrip live={live} peerReview={peerReview} />}

      {live.verdict ? (
        <VerdictCard verdict={live.verdict} onFollowUp={onFollowUp} />
      ) : live.raw ? (
        <div className="rounded-2xl border border-amber-200 bg-white p-4 shadow-sm">
          <p className="mb-2 text-xs font-medium text-amber-700">
            {tl("The Chairman's answer did not match the structured format, so it is shown as plain text.")}
          </p>
          <Markdown text={live.raw} />
        </div>
      ) : running ? (
        live.stage === 'stage3' ? (
          <div className="flex items-center gap-2 rounded-2xl border border-ink-100 bg-white px-4 py-3 text-sm text-ink-600 shadow-sm">
            <Spinner className="h-4 w-4 text-accent-600" /> {tl("The Chairman is weighing the opinions and writing the verdict")}
            {chairman?.text ? ` · ${tl('{n} tokens', { n: Math.round(chairman.text.length / 4) })}` : ''}…
          </div>
        ) : opinions.some((p) => p.text) ? (
          <div className="flex items-center gap-2 rounded-2xl border border-ink-100 bg-white px-4 py-3 text-sm text-ink-600 shadow-sm">
            <Spinner className="h-4 w-4 text-accent-600" />
            {live.stage === 'stage2'
              ? tl('Advisors are reviewing each other’s answers anonymously…')
              : tl('The advisors are giving their opinions ({done}/{total} done). The verdict appears here when the Chairman has decided.', { done: opinions.filter((p) => p.done).length, total: opinions.length })}
          </div>
        ) : (
          <Waiting live={live} />
        )
      ) : null}

      {opinions.length > 0 && (
        <Section title={tl('Advisor opinions ({n})', { n: opinions.length })} defaultOpen={running}>
          <StanceSummary opinions={opinions} />
          <div className="grid items-start gap-2 lg:grid-cols-2">
            {opinions.map((p) => (
              <Collapsible
                key={p.part}
                title={name(p.persona)}
                subtitle={personas[p.persona]?.description ?? undefined}
                badge={p.done && p.data?.stance ? <StanceBadge stance={p.data.stance} /> : undefined}
                status={p.error ? 'error' : p.done ? 'done' : p.text ? 'streaming' : 'waiting'}
                defaultOpen={running && !p.done && Boolean(p.text)}
              >
                {p.error ? <p className="text-sm text-red-700">{tl("Unavailable:")} {p.error}</p> : <Markdown text={p.text} />}
              </Collapsible>
            ))}
          </div>
        </Section>
      )}

      {reviews.length > 0 && (
        <Section title={tl("Peer reviews (anonymised)")}>
          <div className="space-y-2">
            {reviews.map((p) => (
              <Collapsible
                key={p.part}
                title={tl('Review by {name}', { name: name(p.persona) })}
                status={p.error ? 'error' : p.done ? 'done' : 'waiting'}
              >
                <ReviewBody part={p} name={name} />
              </Collapsible>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function ReviewBody({ part, name }: { part: LivePart; name: (k: string) => string }) {
  const scores = part.data?.scores as Record<string, { score: number; flaw: string }> | undefined;
  if (scores && Object.keys(scores).length) {
    return (
      <ul className="space-y-1.5 text-sm">
        {Object.entries(scores).map(([key, s]) => (
          <li key={key}>
            <span className="font-medium">{name(key)}</span>{' '}
            <Badge tone={s.score >= 4 ? 'green' : s.score <= 2 ? 'red' : 'neutral'}>{s.score}/5</Badge>
            <span className="text-ink-600"> {tl("· biggest flaw:")} {s.flaw}</span>
          </li>
        ))}
      </ul>
    );
  }
  return <pre className="text-xs whitespace-pre-wrap text-ink-600">{part.text || part.error}</pre>;
}

const CONFIDENCE_TONE = { low: 'red', medium: 'amber', high: 'green' } as const;

export function VerdictCard({ verdict: v, onFollowUp }: { verdict: Verdict; onFollowUp(text: string, mode?: Mode): void }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-sm">
      <div className="border-b border-ink-100 bg-ink-900 px-5 py-4 text-white">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold tracking-wider text-accent-100 uppercase">{tl("Chairman's verdict")}</span>
          <Badge tone={CONFIDENCE_TONE[v.confidence.level]}>{tl("Confidence:")} {v.confidence.level}</Badge>
        </div>
        <p className="text-base leading-relaxed font-medium">{v.verdict}</p>
      </div>
      <div className="space-y-5 px-5 py-4 text-sm text-ink-800">
        <Block title={tl("Why")}>
          <p className="leading-relaxed">{v.why}</p>
        </Block>

        {v.conflicts.length > 0 && (
          <Block title={tl("Disagreements resolved")}>
            <ul className="space-y-2">
              {v.conflicts.map((c, i) => (
                <li key={i} className="rounded-lg bg-ink-50 p-3">
                  <p className="text-xs font-semibold text-ink-600">{c.between}</p>
                  <div className="mt-1 grid gap-1 sm:grid-cols-2">
                    <p className="text-ink-600">
                      <span className="font-medium text-ink-800">A:</span> {c.position_a}
                    </p>
                    <p className="text-ink-600">
                      <span className="font-medium text-ink-800">B:</span> {c.position_b}
                    </p>
                  </div>
                  <p className="mt-2">
                    <span className="font-semibold text-accent-700">{tl("Decision:")}</span> {c.decision}{' '}
                    <span className="font-semibold text-ink-700">{tl("Because:")}</span>{' '}
                    <span className="text-ink-600">{c.because.replace(/^because\s+/i, '')}</span>
                  </p>
                </li>
              ))}
            </ul>
          </Block>
        )}

        <Block title={tl("Action plan")}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-ink-400">
                <tr>
                  <th className="w-6 py-1 pr-2 font-medium">#</th>
                  <th className="py-1 pr-3 font-medium">{tl("Step")}</th>
                  <th className="py-1 pr-3 font-medium">{tl("Owner")}</th>
                  <th className="py-1 font-medium">{tl("When")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {v.action_plan.map((s, i) => (
                  <tr key={i} className="align-top">
                    <td className="py-2 pr-2 text-ink-400">{i + 1}</td>
                    <td className="py-2 pr-3">{s.step}</td>
                    <td className="py-2 pr-3 whitespace-nowrap text-ink-600">{s.owner_role}</td>
                    <td className="py-2 whitespace-nowrap text-ink-600">{s.timeline}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Block>

        {v.risks.length > 0 && (
          <Block title={tl("Key risks & mitigations")}>
            <ul className="space-y-1.5">
              {v.risks.map((r, i) => (
                <li key={i} className="flex gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                  <span>
                    <span className="font-medium">{r.risk}</span>{' '}
                    {r.likelihood && r.impact && <RiskBadge likelihood={r.likelihood} impact={r.impact} />}{' '}
                    <span className="text-ink-600">→ {r.mitigation}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Block>
        )}

        {v.open_questions.length > 0 && (
          <Block title={tl("Open questions")}>
            <ul className="space-y-1.5">
              {v.open_questions.map((q, i) => (
                <li key={i}>
                  <button
                    className="no-print group flex w-full items-start gap-2 rounded-lg px-2 py-1 text-left text-ink-700 hover:bg-accent-50"
                    title={tl("Answer this and the council will reconsider")}
                    onClick={() => onFollowUp(tl('Answer to the council\'s open question "{q}":', { q }) + '\n', 'council')}
                  >
                    <Icon name="reply" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-600" />
                    <span className="flex-1">{q}</span>
                    <span className="hidden text-xs font-medium text-accent-700 group-hover:inline">{tl("Answer")}</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-1 px-2 text-xs text-ink-400">{tl("Click a question to answer it; the council will reconsider with your answer.")}</p>
          </Block>
        )}

        <div className="rounded-lg border border-ink-100 bg-ink-50 px-3 py-2 text-xs text-ink-600">
          <span className="font-semibold text-ink-800">{tl("What would change this recommendation:")}</span>{' '}
          {v.confidence.what_would_change}
        </div>
      </div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="mb-1.5 text-xs font-semibold tracking-wide text-ink-400 uppercase">{title}</h4>
      {children}
    </section>
  );
}

function Section({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group">
      <summary className="flex cursor-pointer list-none items-center gap-1 py-1 text-xs font-semibold text-ink-600 select-none hover:text-ink-900">
        <Icon name="chevron" className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
        {title}
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

function Collapsible({
  title,
  subtitle,
  badge,
  status,
  defaultOpen,
  children,
}: {
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  status: 'waiting' | 'streaming' | 'done' | 'error';
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  return (
    <div className="rounded-xl border border-ink-100 bg-white">
      <button className="flex w-full items-center gap-2 px-3 py-2 text-left" onClick={() => setOpen((o) => !o)}>
        <Icon name="chevron" className={cx('h-3.5 w-3.5 shrink-0 text-ink-400 transition-transform', open && 'rotate-90')} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink-900">{title}</span>
          {subtitle && <span className="block truncate text-xs text-ink-400">{subtitle}</span>}
        </span>
        {badge}
        {status === 'waiting' && <span className="text-xs text-ink-400">{tl("waiting")}</span>}
        {status === 'streaming' && <Spinner className="h-3.5 w-3.5 text-accent-600" />}
        {status === 'done' && !badge && <span className="h-2 w-2 rounded-full bg-accent-500" />}
        {status === 'error' && <span className="h-2 w-2 rounded-full bg-red-500" />}
      </button>
      {(open || status === 'streaming') && <div className="border-t border-ink-100 px-3 py-2">{children}</div>}
    </div>
  );
}

function Citations({ citations }: { citations: Citation[] }) {
  return (
    <div className="rounded-xl border border-ink-100 bg-white px-3 py-2 text-xs">
      <p className="mb-1 font-semibold text-ink-600">{tl("Sources from the knowledge base")}</p>
      <ul className="space-y-0.5 text-ink-600">
        {citations.map((c) => (
          <li key={c.id}>
            <span className="font-mono text-ink-400">[{c.id}]</span> {c.title}
            {c.section && <span className="text-ink-400"> › {c.section}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Actions({
  message,
  text,
  verdict,
  onFollowUp,
  onWhatIf,
  onDraft,
}: {
  message: Message;
  text: string;
  verdict: Verdict | null;
  onFollowUp(text: string, mode?: Mode): void;
  onWhatIf?(change: string): Promise<void>;
  onDraft?(request: string): void;
}) {
  const [panel, setPanel] = useState<null | 'whatif' | 'draft'>(null);
  const [rating, setRating] = useState<1 | -1 | null>(message.my_rating ?? null);
  const [commenting, setCommenting] = useState(false);
  const [comment, setComment] = useState('');
  const [copied, setCopied] = useState(false);

  async function rate(r: 1 | -1, withComment?: string) {
    setRating(r);
    await api(`/api/messages/${message.id}/feedback`, { body: { rating: r, comment: withComment } }).catch(() => {});
  }

  return (
    <div className="no-print space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          <Icon name="copy" className="h-3.5 w-3.5" /> {copied ? tl('Copied') : tl('Copy')}
        </Button>
        <a
          href={`/api/messages/${message.id}/report.pdf`}
          download
          title={verdict ? tl('Council report with analytics: stances, risk heat map, timeline') : tl('Download this answer as a PDF')}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-ink-600 hover:bg-ink-100 hover:text-ink-900"
        >
          <Icon name="print" className="h-3.5 w-3.5" /> {verdict ? tl('Download report (PDF)') : tl('Export PDF')}
        </a>
        <a
          href={`/api/messages/${message.id}/export.docx`}
          download
          title={tl('Download this answer as a Word document you can edit')}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-ink-600 hover:bg-ink-100 hover:text-ink-900"
        >
          <Icon name="edit" className="h-3.5 w-3.5" /> {tl('Word')}
        </a>
        <ShareButton messageId={message.id} />
        {verdict && <RecordDecision messageId={message.id} />}
        {verdict && onWhatIf && (
          <Button size="sm" variant="ghost" aria-expanded={panel === 'whatif'} onClick={() => setPanel(panel === 'whatif' ? null : 'whatif')}
            title={tl('Change one assumption and let the council update its verdict')}>
            <Icon name="search" className="h-3.5 w-3.5" /> {tl('What if…')}
          </Button>
        )}
        {onDraft && (
          <Button size="sm" variant="ghost" aria-expanded={panel === 'draft'} onClick={() => setPanel(panel === 'draft' ? null : 'draft')}>
            <Icon name="copy" className="h-3.5 w-3.5" /> {tl('Draft a document')}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onFollowUp(verdict ? tl('Follow-up on the verdict ("{v}…"): ', { v: verdict.verdict.slice(0, 80) }) : '')}
        >
          <Icon name="reply" className="h-3.5 w-3.5" /> {tl("Ask a follow-up")}
        </Button>
        <span className="mx-1 h-4 w-px bg-ink-200" />
        <Button
          size="sm"
          variant="ghost"
          aria-pressed={rating === 1}
          className={cx(rating === 1 && 'text-accent-700')}
          onClick={() => rate(1)}
          title={tl("Helpful")}
        >
          <Icon name="up" className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-pressed={rating === -1}
          className={cx(rating === -1 && 'text-red-600')}
          onClick={() => {
            void rate(-1);
            setCommenting(true);
          }}
          title={tl("Not helpful")}
        >
          <Icon name="down" className="h-3.5 w-3.5" />
        </Button>
      </div>
      {commenting && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void rate(rating ?? -1, comment);
            setCommenting(false);
          }}
        >
          <input
            autoFocus
            className="flex-1 rounded-lg border border-ink-200 px-3 py-1.5 text-sm focus:border-accent-600 focus:outline-none"
            placeholder={tl("What was wrong or missing? (optional)")}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <Button size="sm" variant="primary">{tl("Send")}</Button>
        </form>
      )}
      {panel === 'whatif' && onWhatIf && <WhatIfForm onSubmit={async (c) => { await onWhatIf(c); setPanel(null); }} />}
      {panel === 'draft' && onDraft && verdict !== undefined && (
        <DraftPicker
          onPick={(kind) => {
            setPanel(null);
            onDraft(draftRequest(kind, verdict ? verdict.verdict : text));
          }}
        />
      )}
    </div>
  );
}

// ── Stances, risk ratings, clarifying questions ─────────────────────────────

const STANCE_STYLE: Record<Stance['value'], { label: string; cls: string }> = {
  for: { label: 'For', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  conditional: { label: 'Conditional', cls: 'bg-amber-50 text-amber-800 ring-amber-200' },
  against: { label: 'Against', cls: 'bg-red-50 text-red-700 ring-red-200' },
  unclear: { label: 'Unclear', cls: 'bg-ink-100 text-ink-600 ring-ink-200' },
};

function StanceBadge({ stance }: { stance: Stance }) {
  const s = STANCE_STYLE[stance.value];
  return (
    <span className={cx('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1', s.cls)} title={tl("The advisor's own declared stance and conviction")}>
      {tl(s.label)}
      {stance.strength ? ` ${stance.strength}/5` : ''}
    </span>
  );
}

function StanceSummary({ opinions }: { opinions: LivePart[] }) {
  const stances = opinions.map((o) => o.data?.stance as Stance | undefined).filter((s): s is Stance => Boolean(s));
  if (stances.length < 2) return null;
  const order: Stance['value'][] = ['for', 'conditional', 'against', 'unclear'];
  const bar: Record<Stance['value'], string> = { for: 'bg-emerald-500', conditional: 'bg-amber-500', against: 'bg-red-500', unclear: 'bg-ink-200' };
  return (
    <div className="mb-2">
      <div className="flex h-2 overflow-hidden rounded-full">
        {order.map((v) => {
          const n = stances.filter((s) => s.value === v).length;
          return n ? <div key={v} className={bar[v]} style={{ width: `${(n / stances.length) * 100}%` }} /> : null;
        })}
      </div>
      <p className="mt-1 text-xs text-ink-400">
        {order
          .map((v) => [v, stances.filter((s) => s.value === v).length] as const)
          .filter(([, n]) => n)
          .map(([v, n]) => `${n} ${tl(STANCE_STYLE[v].label).toLowerCase()}`)
          .join(' · ')}
      </p>
    </div>
  );
}

const LEVEL_RANK: Record<Level, number> = { low: 0, medium: 1, high: 2 };

function RiskBadge({ likelihood, impact }: { likelihood: Level; impact: Level }) {
  const sev = LEVEL_RANK[likelihood] + LEVEL_RANK[impact];
  return (
    <Badge tone={sev >= 3 ? 'red' : sev === 2 ? 'amber' : 'green'} title={tl("Likelihood · Impact, as rated by the Chairman")}>
      {tl('L')} {tl(likelihood)} · {tl('I')} {tl(impact)}
    </Badge>
  );
}

function ClarifyView({
  clarify,
  onAnswer,
  onSkip,
}: {
  clarify: ClarifyRequest;
  onAnswer(text: string, mode?: Mode): void;
  onSkip(): void;
}) {
  const template = clarify.questions.map((q, i) => `${i + 1}. ${q}\n→ `).join('\n');
  return (
    <div className="rounded-2xl border border-accent-100 bg-white p-4 shadow-sm">
      <p className="text-sm font-medium text-ink-900">{tl("Before the council meets, a few questions so the advice fits your situation:")}</p>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-ink-800">
        {clarify.questions.map((q, i) => (
          <li key={i}>{q}</li>
        ))}
      </ol>
      {clarify.assumptions.length > 0 && (
        <div className="mt-3 rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-600">
          <span className="font-semibold text-ink-800">{tl("If you skip, the council will assume:")}</span>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {clarify.assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="primary" onClick={() => onAnswer(template, 'council')}>
          <Icon name="reply" className="h-3.5 w-3.5" /> {tl("Answer the questions")}
        </Button>
        <Button size="sm" onClick={onSkip}>
          {tl("Skip: go ahead with these assumptions")}
        </Button>
      </div>
    </div>
  );
}

// ── Action Crew entry point ──────────────────────────────────────────────────

/** "Put into action" on a verdict; once a plan exists, shows its progress instead. */
function PutIntoAction({ messageId }: { messageId: string }) {
  const [plan, setPlan] = useState<PlanSummary | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api<PlanSummary>(`/api/messages/${messageId}/plan`).then(setPlan).catch(() => setPlan(null));
  }, [messageId]);

  if (plan === undefined) return null;
  if (plan && plan.status !== 'error') {
    const pct = plan.total ? Math.round((plan.done / plan.total) * 100) : 0;
    return (
      <button
        onClick={() => navigate(`/plans/${plan.id}`)}
        className="no-print block w-full rounded-xl border border-ink-100 bg-white p-3 text-left hover:border-accent-500"
      >
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-ink-800">{tl("Action plan")}</span>
          <span className="text-ink-400">
            {plan.status === 'planning' ? tl('planning…') : plan.status === 'ready' ? statusLabel('ready') : tl('{done}/{total} done', { done: plan.done, total: plan.total })}
            {plan.overdue ? ` · ${tl('{n} overdue', { n: plan.overdue })}` : ''}
          </span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-100">
          <div className="h-full rounded-full bg-accent-500" style={{ width: `${pct}%` }} />
        </div>
      </button>
    );
  }
  return (
    <div className="no-print flex flex-wrap items-center gap-3 rounded-xl border border-accent-100 bg-accent-50/60 p-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink-900">{tl("Put this verdict into action")}</p>
        <p className="text-xs text-ink-600">
          {tl("The Action Crew turns the plan into tasks, finds owners in the staff directory and drafts the emails. You approve before anything is sent.")}
        </p>
        {err && <p className="mt-1 text-xs text-red-700">{err}</p>}
      </div>
      <Button
        size="sm"
        variant="primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            const r = await api<{ id: string }>(`/api/messages/${messageId}/plan`, { method: 'POST' });
            navigate(`/plans/${r.id}`);
          } catch (e) {
            setErr((e as Error).message);
            setBusy(false);
          }
        }}
      >
        {busy ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="send" className="h-3.5 w-3.5" />} {tl("Put into action")}
      </Button>
    </div>
  );
}


/** Copy a read-only link a signed-in colleague can open. */
const DRAFT_KINDS = ['SOP (step-by-step procedure)', 'Policy', 'Customer letter', 'Staff memo'] as const;

function draftRequest(kind: string, basis: string) {
  return `**Draft a document**\n\n**Type:** ${kind}\n\n**Based on the answer above:** ${basis.slice(0, 1500)}\n\n` +
    'Write the full document, ready to review. Mark anything I must fill in as [TO CONFIRM].';
}

function DraftPicker({ onPick }: { onPick(kind: string): void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-ink-200 bg-white p-2 text-xs">
      <span className="text-ink-600">{tl('Draft from this answer:')}</span>
      {DRAFT_KINDS.map((k) => (
        <Button key={k} size="sm" variant="secondary" onClick={() => onPick(k)}>
          {tl(k)}
        </Button>
      ))}
    </div>
  );
}

function WhatIfForm({ onSubmit }: { onSubmit(change: string): Promise<void> }) {
  const [change, setChange] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-2 rounded-lg border border-ink-200 bg-white p-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (change.trim().length < 3) return;
        setBusy(true);
        setError(null);
        try {
          await onSubmit(change.trim());
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="block text-xs text-ink-600">
        {tl('What if… (change one assumption; the Contrarian and the Executor re-run, the Chairman updates the verdict)')}
        <input
          autoFocus
          value={change}
          onChange={(e) => setChange(e.target.value)}
          maxLength={1000}
          placeholder={tl('e.g. the budget is cut by half')}
          className="mt-1 w-full rounded-md border border-ink-200 px-2 py-1.5 text-sm"
        />
      </label>
      {error && <p className="text-xs text-red-700">{error}</p>}
      <Button size="sm" type="submit" disabled={busy || change.trim().length < 3}>
        {busy ? tl('Starting…') : tl('Re-run')}
      </Button>
    </form>
  );
}

function ShareButton({ messageId }: { messageId: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');
  return (
    <Button
      size="sm"
      variant="ghost"
      title={tl("Copy a read-only link for a colleague (they must be signed in)")}
      onClick={async () => {
        try {
          const r = await api<{ path: string }>(`/api/messages/${messageId}/share`, { method: 'POST' });
          await navigator.clipboard.writeText(`${window.location.origin}${r.path}`);
          setState('copied');
        } catch {
          setState('error');
        }
        setTimeout(() => setState('idle'), 2000);
      }}
    >
      <Icon name="reply" className="h-3.5 w-3.5 -scale-x-100" /> {state === 'copied' ? tl('Link copied') : state === 'error' ? tl('Could not share') : tl('Share')}
    </Button>
  );
}
