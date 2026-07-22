import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { NoteRecord } from '../lib/cache/db';
import { VAULT_LABELS } from '../lib/vault/path';
import { notePathname } from '../app/routes';

/** A tappable note row used in search results and the active view. */
export function NoteCard({
  note,
  preview,
  showVault = false,
}: {
  note: NoteRecord;
  /** Optional preview node (e.g. a highlighted excerpt); falls back to the snippet. */
  preview?: ReactNode;
  showVault?: boolean;
}) {
  return (
    <Link
      to={notePathname(note.path)}
      className="block rounded-lg px-3 py-3 no-underline transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-900"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-neutral-900 dark:text-neutral-100">{note.title}</span>
        {showVault && (
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            {VAULT_LABELS[note.vault]}
          </span>
        )}
        {note.type && (
          <span className="rounded-full bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
            {note.type}
          </span>
        )}
        {note.active && (
          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
            active
          </span>
        )}
      </div>
      <p className="mt-0.5 line-clamp-2 text-sm text-neutral-500">{preview ?? note.snippet}</p>
    </Link>
  );
}
