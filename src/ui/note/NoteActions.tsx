import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { NoteRecord } from '../../lib/cache/db';
import { db } from '../../lib/cache/db';
import { currentClient } from '../../state/client';
import { deleteNote, setNoteActive } from '../../lib/vault/mutations';
import { editPathname, vaultHref } from '../../app/routes';
import { useHoldEditorGuard } from '../../state/editorGuard';
import { describeError } from '../errors';

/** Edit / active-toggle / delete controls for a note. */
export function NoteActions({ note }: { note: NoteRecord }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState<null | 'active' | 'delete'>(null);
  const [error, setError] = useState<string | null>(null);
  // Don't let a service-worker update reload the page mid-request.
  useHoldEditorGuard(busy !== null);

  async function toggleActive() {
    const client = currentClient();
    if (!client) return setError('Not connected.');
    setBusy('active');
    setError(null);
    try {
      await setNoteActive(client, db(), note, !note.active);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    const client = currentClient();
    if (!client) return setError('Not connected.');
    if (!window.confirm(`Delete “${note.title}”? This commits a deletion to your vault.`)) return;
    setBusy('delete');
    setError(null);
    try {
      await deleteNote(client, db(), note.path);
      void navigate(vaultHref(note.vault).slice(1), { replace: true });
    } catch (err) {
      setError(describeError(err));
      setBusy(null);
    }
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <Link to={editPathname(note.path)} className={btn}>
        Edit
      </Link>
      <button onClick={() => void toggleActive()} disabled={busy !== null} className={btn}>
        {busy === 'active' ? '…' : note.active ? 'Mark inactive' : 'Mark active'}
      </button>
      <button
        onClick={() => void remove()}
        disabled={busy !== null}
        className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-40 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-950/40"
      >
        {busy === 'delete' ? 'Deleting…' : 'Delete'}
      </button>
      {error && (
        <span role="alert" className="w-full text-sm text-red-600 dark:text-red-400">
          {error}
        </span>
      )}
    </div>
  );
}

const btn =
  'rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-700 no-underline hover:border-neutral-300 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-800 dark:text-neutral-200 dark:hover:border-neutral-700 dark:hover:bg-neutral-900';
