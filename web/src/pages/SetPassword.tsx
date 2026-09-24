import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { LanguageToggle } from '../components/LanguageToggle';
import { Button, Field, inputCls, Spinner } from '../components/ui';
import { setLang, tl } from '../i18n';

/** Opened from an invite or reset email: choose a password, then you're signed in. */
export default function SetPassword() {
  const { refresh } = useAuth();
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  const [info, setInfo] = useState<{ purpose: 'invite' | 'reset'; email: string; name: string; locale: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<typeof info>(`/api/auth/token/${encodeURIComponent(token)}`)
      .then((i) => {
        setInfo(i);
        if (i && (i.locale === 'ms' || i.locale === 'en')) setLang(i.locale);
      })
      .catch((e) => setError(e.message));
  }, [token]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 10) return setError(tl('Use at least 10 characters.'));
    if (password !== confirm) return setError(tl('The two passwords do not match.'));
    setBusy(true);
    try {
      await api('/api/auth/set-password', { body: { token, password } });
      window.history.replaceState(null, '', '/');
      await refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-full items-center justify-center bg-ink-950 px-4 py-12">
      <div className="absolute top-4 right-4">
        <LanguageToggle dark signedIn={false} />
      </div>
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <img src="/favicon.svg" alt="" className="mx-auto mb-4 h-12 w-12" />
          <h1 className="text-2xl font-semibold text-white">Xanderia AI Council</h1>
          <p className="mt-1 text-sm text-ink-200">
            {info?.purpose === 'reset' ? tl('Choose a new password') : tl('Set up your account')}
          </p>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-2xl bg-white p-6 shadow-xl">
          {!info && !error && <Spinner className="mx-auto h-5 w-5 text-ink-400" />}
          {info && (
            <>
              <p className="text-sm text-ink-600">
                {tl('Hi {name}. Your login is', { name: info.name })} <strong className="text-ink-900">{info.email}</strong>.
              </p>
              <Field label={tl('New password')} hint={tl('At least 10 characters')}>
                <input className={inputCls} type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
              <Field label={tl('Confirm password')}>
                <input className={inputCls} type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </Field>
            </>
          )}
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {info && (
            <Button variant="primary" className="w-full" disabled={busy}>
              {busy && <Spinner />} {tl('Save password and sign in')}
            </Button>
          )}
          {!info && error && (
            <a href="/" className="block text-center text-sm font-medium text-accent-700 hover:underline">
              {tl('Go to sign in (use “Forgot password?” for a new link)')}
            </a>
          )}
        </form>
      </div>
    </div>
  );
}
