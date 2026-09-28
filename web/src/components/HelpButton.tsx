import { Link, useLocation } from 'react-router-dom';
import { tl } from '../i18n';
import { guideSectionFor } from '../pages/Guide';
import { cx } from './ui';

/** Small "?" that opens the user guide at the part for the current page. */
export function HelpButton({ dark = false }: { dark?: boolean }) {
  const { pathname } = useLocation();
  if (pathname.startsWith('/guide')) return null;
  return (
    <Link
      to={`/guide#${guideSectionFor(pathname)}`}
      title={tl('User guide')}
      aria-label={tl('User guide')}
      className={cx(
        'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-sm font-semibold',
        dark ? 'border-ink-700 text-ink-200 hover:bg-ink-900 hover:text-white' : 'border-ink-200 text-ink-600 hover:bg-ink-50 hover:text-ink-900',
      )}
    >
      ?
    </Link>
  );
}
