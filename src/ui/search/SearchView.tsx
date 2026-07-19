import { useDeferredValue, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAllNotes } from '../../state/notes';
import { searchNotes } from '../../lib/search/search';
import { excerpt } from '../../lib/search/search';
import { VAULT_LABELS, type VaultId } from '../../lib/vault/path';
import { NoteCard } from '../NoteCard';
import { highlight } from './highlight';

const VAULT_FILTERS: (VaultId | 'all')[] = ['all', 'w', 'm', 'r'];

export function SearchView() {
  const [params] = useSearchParams();
  const query = params.get('q') ?? '';
  const deferredQuery = useDeferredValue(query);
  const notes = useAllNotes();

  const [vault, setVault] = useState<VaultId | 'all'>('all');
  const [activeOnly, setActiveOnly] = useState(false);

  const hits = useMemo(() => {
    if (!notes) return [];
    return searchNotes(notes, deferredQuery, {
      vault: vault === 'all' ? undefined : vault,
      activeOnly,
    });
  }, [notes, deferredQuery, vault, activeOnly]);

  const hasQuery = deferredQuery.trim().length > 0;

  return (
    <div>
      <h1 className="text-2xl font-semibold">Search</h1>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {VAULT_FILTERS.map((v) => (
          <button key={v} onClick={() => setVault(v)} className={chip(vault === v)}>
            {v === 'all' ? 'All' : VAULT_LABELS[v]}
          </button>
        ))}
        <button onClick={() => setActiveOnly((a) => !a)} className={chip(activeOnly)}>
          Active
        </button>
      </div>

      {!hasQuery && !activeOnly ? (
        <p className="mt-8 text-sm text-neutral-400">
          Type in the search box to find notes by title, tag, type, or content.
        </p>
      ) : notes === undefined ? (
        <p className="mt-8 text-sm text-neutral-400">Loading…</p>
      ) : hits.length === 0 ? (
        <p className="mt-8 text-sm text-neutral-400">No matches.</p>
      ) : (
        <>
          <p className="mt-6 text-xs text-neutral-400">
            {hits.length} result{hits.length === 1 ? '' : 's'}
          </p>
          <div className="mt-1 flex flex-col">
            {hits.map(({ note }) => (
              <NoteCard
                key={note.path}
                note={note}
                showVault={vault === 'all'}
                preview={
                  hasQuery ? highlight(excerpt(note.body, deferredQuery), deferredQuery) : undefined
                }
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function chip(active: boolean): string {
  return active
    ? 'rounded-full bg-neutral-900 px-3 py-1 text-sm text-white dark:bg-white dark:text-neutral-900'
    : 'rounded-full border border-neutral-200 px-3 py-1 text-sm text-neutral-600 hover:border-neutral-300 dark:border-neutral-800 dark:text-neutral-300 dark:hover:border-neutral-700';
}
