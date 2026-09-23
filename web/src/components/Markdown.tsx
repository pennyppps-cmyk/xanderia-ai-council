import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cx } from './ui';

/** Model output as Markdown. Raw HTML is not rendered (react-markdown escapes it by default). */
export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div
      className={cx(
        'prose prose-sm max-w-none prose-headings:mb-2 prose-headings:mt-4 prose-p:my-2 prose-li:my-0.5 prose-ul:my-2 prose-ol:my-2',
        'prose-a:text-accent-700 prose-strong:text-ink-900 prose-code:before:content-none prose-code:after:content-none',
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}
