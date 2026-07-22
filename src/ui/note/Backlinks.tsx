import { Link } from 'react-router-dom';
import { pathMeta } from '../../lib/vault/path';
import { notePathname } from '../../app/routes';

/** "Linked from" — notes that wikilink to the current one. */
export function Backlinks({ paths }: { paths: string[] }) {
  if (paths.length === 0) return null;
  return (
    <section className="mt-12 border-t border-neutral-200 pt-6 dark:border-neutral-800">
      <h2 className="text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
        Linked from ({paths.length})
      </h2>
      <ul className="mt-3 flex flex-col gap-1.5">
        {paths.map((p) => (
          <li key={p}>
            <Link
              to={notePathname(p)}
              className="text-sm text-sky-700 no-underline hover:underline dark:text-sky-400"
            >
              {pathMeta(p).filename}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
