import { api } from '../api';
import { getLang, setLang, useLang, type Lang } from '../i18n';
import { cx } from './ui';

/** EN | BM switch. Signed-in users' choice is saved to their account (follows them across devices). */
export function LanguageToggle({ dark = false, signedIn = true }: { dark?: boolean; signedIn?: boolean }) {
  const lang = useLang();
  const choose = (l: Lang) => {
    if (l === getLang()) return;
    setLang(l);
    if (signedIn) api('/api/auth/locale', { method: 'PATCH', body: { locale: l } }).catch(() => {});
  };
  return (
    <div
      role="radiogroup"
      aria-label="Language / Bahasa"
      className={cx('inline-flex rounded-md p-0.5 text-[11px] font-semibold', dark ? 'bg-ink-900' : 'bg-ink-100')}
    >
      {(['en', 'ms'] as const).map((l) => (
        <button
          key={l}
          role="radio"
          aria-checked={lang === l}
          title={l === 'en' ? 'English' : 'Bahasa Malaysia'}
          onClick={() => choose(l)}
          className={cx(
            'rounded px-1.5 py-0.5',
            lang === l ? (dark ? 'bg-ink-700 text-white' : 'bg-white text-ink-900 shadow-sm') : dark ? 'text-ink-400 hover:text-white' : 'text-ink-600',
          )}
        >
          {l === 'en' ? 'EN' : 'BM'}
        </button>
      ))}
    </div>
  );
}
