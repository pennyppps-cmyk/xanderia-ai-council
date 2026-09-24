import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { LanguageToggle } from '../components/LanguageToggle';
import { getLang } from '../i18n';
import { useAuth } from '../auth';
import { Button, Field, inputCls, Spinner } from '../components/ui';
import { tl } from '../i18n';

export default function Login() {
  const { refresh } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/auth/login', { body: { email, password } });
      await api('/api/auth/locale', { method: 'PATCH', body: { locale: getLang() } }).catch(() => {});
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
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
          <h1 className="text-2xl font-semibold text-white">{tl("Xanderia AI Council")}</h1>
          <p className="mt-1 text-sm text-ink-200">{tl("Internal AI advisory · processed on-premises")}</p>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-2xl bg-white p-6 shadow-xl">
          <Field label={tl("Work email")}>
            <input
              className={inputCls}
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label={tl("Password")}>
            <input
              className={inputCls}
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <Button variant="primary" className="w-full" disabled={busy}>
            {busy && <Spinner />} {tl("Sign in")}
          </Button>
          <p className="text-center text-xs text-ink-400">{tl("Accounts are created by your administrator.")}</p>
        </form>
      </div>
    </div>
  );
}
