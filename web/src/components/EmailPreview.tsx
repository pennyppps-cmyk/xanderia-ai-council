import { useEffect, useState } from 'react';
import { api } from '../api';
import { tl } from '../i18n';
import { Badge, Spinner } from './ui';

interface Preview {
  from: { name: string; address: string; via: 'mailbox' | 'waiting' | 'system' };
  to: string | null;
  to_name: string | null;
  subject: string;
  in_thread: boolean;
  html: string;
}

/** The email rendered as the recipient sees it. Sandboxed: no scripts, and the buttons are inert. */
function Letter({ html }: { html: string }) {
  return <iframe title={tl('Email preview')} sandbox="" srcDoc={html} className="h-[28rem] w-full rounded-b-lg border-0 bg-[#f3f6f8]" />;
}

function Headers({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <div className="space-y-0.5 rounded-t-lg border-b border-ink-100 bg-white px-3 py-2 text-xs">
      {rows.map(([k, v]) => (
        <p key={k} className="flex gap-2">
          <span className="w-14 shrink-0 text-ink-400">{k}</span>
          <span className="min-w-0 break-words text-ink-800">{v}</span>
        </p>
      ))}
    </div>
  );
}

/** Before approving: the task email with the unsaved note and owner, refreshed as the note is edited. */
export function TaskEmailPreview({ taskId, emailBody, ownerId }: { taskId: string; emailBody: string; ownerId: string | null }) {
  const [p, setP] = useState<Preview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const h = setTimeout(() => {
      api<Preview>(`/api/tasks/${taskId}/email-preview`, { body: { email_body: emailBody, directory_id: ownerId } })
        .then((r) => {
          setP(r);
          setErr(null);
        })
        .catch((e) => setErr((e as Error).message));
    }, 400);
    return () => clearTimeout(h);
  }, [taskId, emailBody, ownerId]);

  if (err) return <p className="text-xs text-red-700">{err}</p>;
  if (!p) return <Spinner className="h-4 w-4 text-ink-400" />;
  const from =
    p.from.via === 'mailbox'
      ? `${p.from.name} <${p.from.address}>`
      : p.from.via === 'waiting'
        ? tl('Your Microsoft mailbox (connect it to send)')
        : `${p.from.name} <${p.from.address}>`;
  return (
    <div className="overflow-hidden rounded-lg border border-ink-200">
      <Headers
        rows={[
          [tl('From'), from],
          [tl('To'), p.to ? `${p.to_name ?? ''} <${p.to}>` : <span className="text-amber-700">{tl('Choose an owner first')}</span>],
          [
            tl('Subject'),
            <>
              {p.subject} {p.in_thread && <Badge tone="blue">{tl('same thread as earlier emails')}</Badge>}
            </>,
          ],
        ]}
      />
      <Letter html={p.html} />
    </div>
  );
}

interface SentEmail {
  id: string;
  kind: string;
  to: string;
  subject: string;
  status: string;
  error: string | null;
  created_at: string;
  sent_at: string | null;
  in_thread: boolean;
  html: string;
}

const STATUS: Record<string, string> = { queued: 'waiting to send', sent: 'sent', logged: 'recorded in outbox (not sent)', failed: 'failed', blocked: 'blocked' };

/** After sending: every email for the task, exactly as sent. */
export function SentTaskEmails({ taskId }: { taskId: string }) {
  const [list, setList] = useState<SentEmail[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    api<SentEmail[]>(`/api/tasks/${taskId}/emails`).then((l) => {
      setList(l);
      setOpen(l.at(-1)?.id ?? null);
    });
  }, [taskId]);
  if (!list) return <Spinner className="h-4 w-4 text-ink-400" />;
  if (!list.length) return <p className="text-xs text-ink-400">{tl('No email yet.')}</p>;
  return (
    <div className="space-y-1.5">
      {list.map((e) => (
        <div key={e.id} className="overflow-hidden rounded-lg border border-ink-200">
          <button className="flex w-full items-center justify-between gap-2 bg-ink-50 px-2 py-1 text-left text-xs" onClick={() => setOpen(open === e.id ? null : e.id)}>
            <span className="min-w-0 truncate font-medium text-ink-800">{tl(`${e.kind} email`)}</span>
            <span className="shrink-0 text-ink-500">
              {tl(STATUS[e.status] ?? e.status)} · {new Date(e.sent_at ?? e.created_at).toLocaleString()}
            </span>
          </button>
          {open === e.id && (
            <>
              <Headers
                rows={[
                  [tl('To'), e.to],
                  [tl('Subject'), e.subject],
                  ...(e.error ? ([[tl('Note'), <span className="text-amber-700">{e.error}</span>]] as Array<[string, React.ReactNode]>) : []),
                ]}
              />
              <Letter html={e.html} />
            </>
          )}
        </div>
      ))}
    </div>
  );
}
