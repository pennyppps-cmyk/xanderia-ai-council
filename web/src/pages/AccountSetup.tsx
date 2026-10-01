import { useState, type FormEvent, type ReactNode } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { LanguageToggle } from '../components/LanguageToggle';
import { Button, Field, inputCls, Spinner } from '../components/ui';
import { tl } from '../i18n';

/** Read once: ?mailbox=connected or ?mailbox_error=... set by the Microsoft callback. */
export function takeMailboxResult(): { connected: boolean; error: string | null } {
  const p = new URLSearchParams(window.location.search);
  const r = { connected: p.get('mailbox') === 'connected', error: p.get('mailbox_error') };
  if (r.connected || r.error) window.history.replaceState(null, '', window.location.pathname);
  return r;
}

export async function startMicrosoftConnect() {
  const { url } = await api<{ url: string }>('/api/auth/microsoft/start');
  window.location.href = url;
}

function Shell({ step, title, children }: { step?: string; title: string; children: ReactNode }) {
  const { logout } = useAuth();
  return (
    <div className="relative flex min-h-full items-center justify-center bg-ink-950 px-4 py-12">
      <div className="absolute top-4 right-4">
        <LanguageToggle dark />
      </div>
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <img src="/favicon.svg" alt="" className="mx-auto mb-4 h-12 w-12" />
          <h1 className="text-2xl font-semibold text-white">{tl('Xanderia AI Council')}</h1>
          {step && <p className="mt-1 text-xs tracking-wide text-ink-300 uppercase">{step}</p>}
          <p className="mt-1 text-sm text-ink-200">{title}</p>
        </div>
        <div className="space-y-4 rounded-2xl bg-white p-6 shadow-xl">{children}</div>
        <button onClick={logout} className="mx-auto mt-4 block text-xs text-ink-300 hover:text-white">
          {tl('Sign out')}
        </button>
      </div>
    </div>
  );
}

/** First sign-in with a temporary password: choose your own before anything else. */
export function ChangeTempPassword() {
  const { me, refresh } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const steps = me?.mailbox.configured ? 2 : 1;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (next.length < 10) return setError(tl('Use at least 10 characters.'));
    if (next !== confirm) return setError(tl('The two passwords do not match.'));
    setBusy(true);
    try {
      await api('/api/auth/password', { body: { current, next } });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Shell step={steps > 1 ? tl('Step {n} of {total}', { n: 1, total: steps }) : undefined} title={tl('Choose your own password')}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-ink-600">
          {tl('Welcome, {name}. You signed in with a temporary password; choose your own to continue.', { name: me?.user.display_name ?? '' })}
        </p>
        <Field label={tl('Temporary password (from the email)')}>
          <input className={inputCls} type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label={tl('New password')} hint={tl('At least 10 characters')}>
          <input className={inputCls} type="password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field label={tl('Confirm password')}>
          <input className={inputCls} type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <Button variant="primary" className="w-full" disabled={busy}>
          {busy && <Spinner />} {tl('Save password')}
        </Button>
      </form>
    </Shell>
  );
}

/** Every user connects their own Microsoft mailbox, so emails they cause come from them. */
export function ConnectMailbox({ error: initialError }: { error?: string | null }) {
  const { me } = useAuth();
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [busy, setBusy] = useState(false);
  const mb = me!.mailbox;
  const reconnect = mb.status === 'expired';

  return (
    <Shell title={reconnect ? tl('Reconnect your Microsoft email') : tl('Connect your Microsoft work email')}>
      {reconnect ? (
        <p className="text-sm text-ink-600">
          {tl('Microsoft no longer accepts the connection to {address} (for example after a password change). Sign in again to continue.', { address: mb.address ?? '' })}
          {mb.held > 0 && <strong className="mt-2 block text-ink-900">{tl('{n} email(s) are waiting to be sent from your mailbox.', { n: mb.held })}</strong>}
        </p>
      ) : (
        <>
          <p className="text-sm text-ink-600">
            {tl('Tasks, reminders and other emails from plans you make are sent to staff from your own mailbox, so they see who it is from and can reply to you directly.')}
          </p>
          <ul className="list-disc space-y-1 pl-5 text-xs text-ink-500">
            <li>{tl('You sign in on Microsoft’s own page; the Council never sees your Microsoft password.')}</li>
            <li>{tl('The Council can only send email as you. It cannot read your mailbox.')}</li>
            <li>{tl('Sent emails appear in your Sent Items. You can switch to another account later from the menu.')}</li>
          </ul>
          {mb.held > 0 && <p className="text-sm font-medium text-ink-900">{tl('{n} email(s) are waiting to be sent from your mailbox.', { n: mb.held })}</p>}
        </>
      )}
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <Button
        variant="primary"
        className="w-full"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await startMicrosoftConnect();
          } catch (err) {
            setError((err as Error).message);
            setBusy(false);
          }
        }}
      >
        {busy && <Spinner />} {reconnect ? tl('Reconnect with Microsoft') : tl('Connect with Microsoft')}
      </Button>
      <p className="text-center text-xs text-ink-400">{tl('Problem connecting? Ask your administrator.')}</p>
    </Shell>
  );
}
