import { useRef, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import type { Citation, Message, Verdict } from '../types';
import { useMessageStream, type LivePart, type LiveState } from '../useMessageStream';
import { Markdown } from './Markdown';
import { Badge, Button, cx, Icon, Spinner, Typing } from './ui';

interface Props {
  message: Message;
  onFinished(): void;
  onFollowUp(text: string): void;
  onRetry(): void;
}

export function AssistantMessage({ message, onFinished, onFollowUp, onRetry }: Props) {
  const live = useMessageStream(message, onFinished);
  const { departments } = useAuth();
  const dept = departments.find((d) => d.id === message.department_id);
  const printRef = useRef<HTMLDivElement>(null);
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
      <div ref={printRef} className="min-w-0 flex-1 space-y-3">
        <Header live={live} mode={mode} message={message} reviewFlag={Boolean(dept?.review_before_acting)} />

        {live.status === 'error' ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <p className="font-medium">This answer could not be completed.</p>
            <p className="mt-1 text-red-700">{live.error}</p>
            <Button size="sm" variant="danger" className="no-print mt-3" onClick={onRetry}>
              <Icon name="retry" /> Try again
            </Button>
          </div>
        ) : mode === 'council' ? (
          <CouncilView live={live} message={message} />
        ) : (
          <QuickView live={live} text={text} />
        )}

        {live.citations.length > 0 && <Citations citations={live.citations} />}

        {finished && (
          <Actions
            message={message}
            text={text}
            verdict={live.verdict}
            onFollowUp={onFollowUp}
            onPrint={() => {
              const el = printRef.current;
              if (!el) return;
              el.setAttribute('data-printing', '');
              document.body.classList.add('printing');
              window.print();
              document.body.classList.remove('printing');
              el.removeAttribute('data-printing');
            }}
          />
        )}
      </div>
    </div>
  );
}

function Header({ live, mode, message, reviewFlag }: { live: LiveState; mode: string | null; message: Message; reviewFlag: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-400">
      <span className="font-semibold text-ink-800">{mode === 'council' ? 'Council' : mode === 'quick' ? 'Quick answer' : 'Assistant'}</span>
      {live.router && (
        <span title={live.router.reason}>
          · {live.router.intent}
          {live.router.source === 'fallback' && ' (heuristic)'}
        </span>
      )}
      {message.requested_mode === 'auto' && live.router && (
        <Badge tone="blue" title="Mode chosen automatically by the router">auto → {live.router.suggested_mode}</Badge>
      )}
      {!message.cloud_used && (
        <Badge tone="green" title="Every model call for this answer ran on Xanderia's own servers">
          <Icon name="shield" className="h-3 w-3" /> Processed on-premises
        </Badge>
      )}
      {live.router?.sensitivity === 'high' && <Badge tone="amber">Sensitive: kept local</Badge>}
      {reviewFlag && <Badge tone="red">Review before acting</Badge>}
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
      ? `Queued${live.position ? ` · position ${live.position}` : ''}. The model is busy with other requests.`
      : live.stage === 'router'
        ? 'Reading your question…'
        : 'Thinking…';
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
              {s.label}
              {s.key === 'stage1' && count(opinions)}
              {s.key === 'stage2' && count(reviews)}
            </span>
          </li>
        );
      })}
      {live.position ? <span className="ml-2 text-ink-400">queued · position {live.position}</span> : null}
    </ol>
  );
}

function CouncilView({ live, message }: { live: LiveState; message: Message }) {
  const { personas } = useAuth();
  const opinions = Object.values(live.parts).filter((p) => p.stage === 1);
  const reviews = Object.values(live.parts).filter((p) => p.stage === 2);
  const chairman = live.parts.chairman;
  const name = (key: string) => personas[key]?.name ?? key;
  const peerReview = Boolean(message.options?.peerReview) || reviews.length > 0;
  const running = live.status !== 'done';

  return (
    <div className="space-y-3">
      {running && <ProgressStrip live={live} peerReview={peerReview} />}

      {live.verdict ? (
        <VerdictCard verdict={live.verdict} />
      ) : live.raw ? (
        <div className="rounded-2xl border border-amber-200 bg-white p-4 shadow-sm">
          <p className="mb-2 text-xs font-medium text-amber-700">
            The Chairman's answer did not match the structured format, so it is shown as plain text.
          </p>
          <Markdown text={live.raw} />
        </div>
      ) : running ? (
        live.stage === 'stage3' ? (
          <div className="flex items-center gap-2 rounded-2xl border border-ink-100 bg-white px-4 py-3 text-sm text-ink-600 shadow-sm">
            <Spinner className="h-4 w-4 text-accent-600" /> The Chairman is weighing the opinions and writing the verdict
            {chairman?.text ? ` · ${Math.round(chairman.text.length / 4)} tokens` : ''}…
          </div>
        ) : opinions.some((p) => p.text) ? (
          <div className="flex items-center gap-2 rounded-2xl border border-ink-100 bg-white px-4 py-3 text-sm text-ink-600 shadow-sm">
            <Spinner className="h-4 w-4 text-accent-600" />
            {live.stage === 'stage2'
              ? 'Advisors are reviewing each other’s answers anonymously…'
              : `The advisors are giving their opinions (${opinions.filter((p) => p.done).length}/${opinions.length} done). The verdict appears here when the Chairman has decided.`}
          </div>
        ) : (
          <Waiting live={live} />
        )
      ) : null}

      {opinions.length > 0 && (
        <Section title={`Advisor opinions (${opinions.length})`} defaultOpen={running}>
          <div className="grid items-start gap-2 lg:grid-cols-2">
            {opinions.map((p) => (
              <Collapsible
                key={p.part}
                title={name(p.persona)}
                subtitle={personas[p.persona]?.description ?? undefined}
                status={p.error ? 'error' : p.done ? 'done' : p.text ? 'streaming' : 'waiting'}
                defaultOpen={running && !p.done && Boolean(p.text)}
              >
                {p.error ? <p className="text-sm text-red-700">Unavailable: {p.error}</p> : <Markdown text={p.text} />}
              </Collapsible>
            ))}
          </div>
        </Section>
      )}

      {reviews.length > 0 && (
        <Section title="Peer reviews (anonymised)">
          <div className="space-y-2">
            {reviews.map((p) => (
              <Collapsible
                key={p.part}
                title={`Review by ${name(p.persona)}`}
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
            <span className="text-ink-600"> · biggest flaw: {s.flaw}</span>
          </li>
        ))}
      </ul>
    );
  }
  return <pre className="text-xs whitespace-pre-wrap text-ink-600">{part.text || part.error}</pre>;
}

const CONFIDENCE_TONE = { low: 'red', medium: 'amber', high: 'green' } as const;

function VerdictCard({ verdict: v }: { verdict: Verdict }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-sm">
      <div className="border-b border-ink-100 bg-ink-900 px-5 py-4 text-white">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold tracking-wider text-accent-100 uppercase">Chairman's verdict</span>
          <Badge tone={CONFIDENCE_TONE[v.confidence.level]}>Confidence: {v.confidence.level}</Badge>
        </div>
        <p className="text-base leading-relaxed font-medium">{v.verdict}</p>
      </div>
      <div className="space-y-5 px-5 py-4 text-sm text-ink-800">
        <Block title="Why">
          <p className="leading-relaxed">{v.why}</p>
        </Block>

        {v.conflicts.length > 0 && (
          <Block title="Disagreements resolved">
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
                    <span className="font-semibold text-accent-700">Decision:</span> {c.decision}{' '}
                    <span className="font-semibold text-ink-700">Because:</span>{' '}
                    <span className="text-ink-600">{c.because.replace(/^because\s+/i, '')}</span>
                  </p>
                </li>
              ))}
            </ul>
          </Block>
        )}

        <Block title="Action plan">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-ink-400">
                <tr>
                  <th className="w-6 py-1 pr-2 font-medium">#</th>
                  <th className="py-1 pr-3 font-medium">Step</th>
                  <th className="py-1 pr-3 font-medium">Owner</th>
                  <th className="py-1 font-medium">When</th>
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
          <Block title="Key risks & mitigations">
            <ul className="space-y-1.5">
              {v.risks.map((r, i) => (
                <li key={i} className="flex gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                  <span>
                    <span className="font-medium">{r.risk}</span> <span className="text-ink-600">→ {r.mitigation}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Block>
        )}

        {v.open_questions.length > 0 && (
          <Block title="Open questions">
            <ul className="list-disc space-y-1 pl-5 text-ink-700">
              {v.open_questions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          </Block>
        )}

        <div className="rounded-lg border border-ink-100 bg-ink-50 px-3 py-2 text-xs text-ink-600">
          <span className="font-semibold text-ink-800">What would change this recommendation:</span>{' '}
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
  status,
  defaultOpen,
  children,
}: {
  title: string;
  subtitle?: string;
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
        {status === 'waiting' && <span className="text-xs text-ink-400">waiting</span>}
        {status === 'streaming' && <Spinner className="h-3.5 w-3.5 text-accent-600" />}
        {status === 'done' && <span className="h-2 w-2 rounded-full bg-accent-500" />}
        {status === 'error' && <span className="h-2 w-2 rounded-full bg-red-500" />}
      </button>
      {(open || status === 'streaming') && <div className="border-t border-ink-100 px-3 py-2">{children}</div>}
    </div>
  );
}

function Citations({ citations }: { citations: Citation[] }) {
  return (
    <div className="rounded-xl border border-ink-100 bg-white px-3 py-2 text-xs">
      <p className="mb-1 font-semibold text-ink-600">Sources from the knowledge base</p>
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
  onPrint,
}: {
  message: Message;
  text: string;
  verdict: Verdict | null;
  onFollowUp(text: string): void;
  onPrint(): void;
}) {
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
          <Icon name="copy" className="h-3.5 w-3.5" /> {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onPrint}>
          <Icon name="print" className="h-3.5 w-3.5" /> Export PDF
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onFollowUp(verdict ? `Follow-up on the verdict ("${verdict.verdict.slice(0, 80)}…"): ` : '')}
        >
          <Icon name="reply" className="h-3.5 w-3.5" /> Ask a follow-up
        </Button>
        <span className="mx-1 h-4 w-px bg-ink-200" />
        <Button
          size="sm"
          variant="ghost"
          aria-pressed={rating === 1}
          className={cx(rating === 1 && 'text-accent-700')}
          onClick={() => rate(1)}
          title="Helpful"
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
          title="Not helpful"
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
            placeholder="What was wrong or missing? (optional)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <Button size="sm" variant="primary">Send</Button>
        </form>
      )}
    </div>
  );
}
