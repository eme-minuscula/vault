import { Link, useParams } from 'react-router-dom';
import { useVaultNotes } from '../state/notes';
import { VAULT_LABELS, type VaultId } from '../lib/vault/path';
import type { NoteRecord } from '../lib/cache/db';
import { notePathname } from '../app/routes';

const VALID: VaultId[] = ['w', 'm', 'r', '_inbox', 'other'];

/** Browse one vault: notes grouped by folder. */
export function VaultView() {
  const { vault } = useParams<{ vault: string }>();
  const vaultId = VALID.includes(vault as VaultId) ? (vault as VaultId) : undefined;
  const notes = useVaultNotes(vaultId);

  if (!vaultId) return <NotFound label="Unknown vault" />;

  return (
    <div>
      <Link
        to="/"
        className="text-sm text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
      >
        ← Library
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">{VAULT_LABELS[vaultId]}</h1>

      {notes === undefined ? (
        <p className="mt-6 text-sm text-neutral-400">Loading…</p>
      ) : notes.length === 0 ? (
        <p className="mt-6 text-sm text-neutral-400">No notes here yet.</p>
      ) : (
        <FolderList notes={notes} />
      )}
    </div>
  );
}

function FolderList({ notes }: { notes: NoteRecord[] }) {
  const groups = new Map<string, NoteRecord[]>();
  for (const n of notes) {
    const arr = groups.get(n.folder) ?? [];
    arr.push(n);
    groups.set(n.folder, arr);
  }
  const folders = [...groups.keys()].sort();

  return (
    <div className="mt-6 flex flex-col gap-8">
      {folders.map((folder) => (
        <section key={folder}>
          <h2 className="mb-2 text-xs font-medium tracking-wide text-neutral-400 uppercase">
            {folder || 'Root'}
          </h2>
          <ul className="flex flex-col divide-y divide-neutral-100 dark:divide-neutral-900">
            {(groups.get(folder) ?? []).map((n) => (
              <NoteRow key={n.path} note={n} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function NoteRow({ note }: { note: NoteRecord }) {
  return (
    <li>
      <Link to={notePathname(note.path)} className="block py-3 no-underline">
        <div className="flex items-center gap-2">
          <span className="font-medium text-neutral-900 dark:text-neutral-100">{note.title}</span>
          {note.active && (
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
              active
            </span>
          )}
        </div>
        {note.snippet && (
          <p className="mt-0.5 line-clamp-2 text-sm text-neutral-500">{note.snippet}</p>
        )}
      </Link>
    </li>
  );
}

function NotFound({ label }: { label: string }) {
  return (
    <div>
      <Link to="/" className="text-sm text-neutral-400 hover:text-neutral-700">
        ← Library
      </Link>
      <p className="mt-6 text-neutral-500">{label}.</p>
    </div>
  );
}
