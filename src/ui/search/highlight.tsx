import { Fragment, type ReactNode } from 'react';
import { tokenize } from '../../lib/search/search';

/** Wrap occurrences of any query term in <mark> for result previews. */
export function highlight(text: string, query: string): ReactNode {
  const terms = tokenize(query);
  if (terms.length === 0) return text;

  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const splitRe = new RegExp(`(${escaped.join('|')})`, 'gi');
  const isTerm = new RegExp(`^(?:${escaped.join('|')})$`, 'i');
  const parts = text.split(splitRe);

  return parts.map((part, i) =>
    isTerm.test(part) ? (
      <mark key={i} className="rounded bg-amber-200/70 text-inherit dark:bg-amber-400/25">
        {part}
      </mark>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}
