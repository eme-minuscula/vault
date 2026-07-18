import { pathMeta } from '../../lib/vault/path';
import { noteHref } from '../../app/routes';

/** "Linked from" — notes that wikilink to the current one. */
export function Backlinks({ paths }: { paths: string[] }) {
  if (paths.length === 0) return null;
  return (
    <section className="mt-12 border-t border-neutral-200 pt-6 dark:border-neutral-800">
      <h2 className="text-xs font-medium tracking-wide text-neutral-400 uppercase">
        Linked from ({paths.length})
      </h2>
      <ul className="mt-3 flex flex-col gap-1.5">
        {paths.map((p) => (
          <li key={p}>
            <a
              href={noteHref(p)}
              className="text-sm text-sky-700 no-underline hover:underline dark:text-sky-400"
            >
              {pathMeta(p).filename}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
