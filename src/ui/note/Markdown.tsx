import { useMemo, type ComponentPropsWithoutRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { remarkWikiLinks, type WikiResolver } from '../../lib/markdown/remarkWikiLinks';
import { isInternalNoteHref, MISSING_HREF } from '../../app/routes';

/**
 * Renders note markdown safely.
 *
 * Security: note content is untrusted. `rehype-sanitize` strips scripts, event
 * handlers, and dangerous URL schemes; we never use dangerouslySetInnerHTML.
 * External links open in a new tab with `rel="noreferrer noopener"`. Internal
 * wikilinks become hash routes; unresolved ones render as inert "broken" text.
 */
export function Markdown({ body, resolve }: { body: string; resolve: WikiResolver }) {
  const remarkPlugins = useMemo(() => [remarkGfm, remarkWikiLinks(resolve)], [resolve]);

  return (
    <div className="prose prose-neutral dark:prose-invert prose-headings:font-semibold prose-a:font-normal max-w-none">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={[rehypeSanitize]}
        components={{ a: Anchor }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}

function Anchor({ href, children, ...rest }: ComponentPropsWithoutRef<'a'>) {
  if (!href) return <>{children}</>;

  if (href === MISSING_HREF) {
    return (
      <span
        className="cursor-help rounded bg-neutral-100 px-1 text-neutral-400 line-through decoration-neutral-300 dark:bg-neutral-800 dark:text-neutral-500"
        title="No matching note in this vault"
      >
        {children}
      </span>
    );
  }

  if (isInternalNoteHref(href)) {
    // Hash navigation is handled by the router; a plain anchor is enough.
    return (
      <a href={href} className="text-sky-700 no-underline hover:underline dark:text-sky-400">
        {children}
      </a>
    );
  }

  // In-page fragment links (e.g. [jump](#section)) stay in the current view.
  if (href.startsWith('#')) {
    return <a href={href}>{children}</a>;
  }

  return (
    <a href={href} target="_blank" rel="noreferrer noopener" {...rest}>
      {children}
    </a>
  );
}
