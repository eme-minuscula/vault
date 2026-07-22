import { useActiveNotes } from '../state/notes';
import { VAULT_LABELS, type VaultId } from '../lib/vault/path';
import type { NoteRecord } from '../lib/cache/db';
import { NoteCard } from './NoteCard';

const ORDER: VaultId[] = ['w', 'm', 'r', '_inbox', 'other'];

/**
 * Active view — notes flagged `active: true`, i.e. what's in flight right now.
 * Redesigned for this app: a single, calm, grouped column that matches the
 * reading surface rather than a separate Keep-style grid.
 */
export function ActiveView() {
  const notes = useActiveNotes();

  if (notes === undefined) {
    return <p className="text-sm text-neutral-500 dark:text-neutral-400">Loading…</p>;
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">Active</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Notes you’ve flagged as in-flight, across every vault.
      </p>

      {notes.length === 0 ? (
        <p className="mt-8 text-sm text-neutral-500 dark:text-neutral-400">
          Nothing active right now. Notes marked <code>active: true</code> show up here.
        </p>
      ) : (
        <div className="mt-6 flex flex-col gap-8">
          {ORDER.map((vault) => {
            const group = notes.filter((n) => n.vault === vault);
            if (group.length === 0) return null;
            return <Group key={vault} vault={vault} notes={group} />;
          })}
        </div>
      )}
    </div>
  );
}

function Group({ vault, notes }: { vault: VaultId; notes: NoteRecord[] }) {
  return (
    <section>
      <h2 className="mb-1 text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
        {VAULT_LABELS[vault]} · {notes.length}
      </h2>
      <div className="flex flex-col">
        {notes.map((n) => (
          <NoteCard key={n.path} note={n} />
        ))}
      </div>
    </section>
  );
}
