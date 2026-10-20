import { useId, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { db, fullText, type NoteRecord } from '../../lib/cache/db';
import { findBacklinks, linksBrokenByMove, namesake, toResolvable } from '../../lib/vault/links';
import {
  isPathTaken,
  moveNote,
  MoveIncompleteError,
  MoveSourceChangedError,
  saveNoteText,
} from '../../lib/vault/mutations';
import { composeMovedText, planNewNote, type NewNoteTarget } from '../../lib/vault/newNote';
import { GitHubError } from '../../lib/github/errors';
import { pathMeta } from '../../lib/vault/path';
import { currentClient } from '../../state/client';
import { useHoldEditorGuard } from '../../state/editorGuard';
import {
  useFolderOptions,
  useNoteSnapshot,
  usePendingCount,
  useVaultNotes,
  useVaultPaths,
} from '../../state/notes';
import { notePathname } from '../../app/routes';
import { describeError } from '../errors';
import { NoteLocationFields, type NoteLocationValue } from './NoteLocationFields';

/** Move or rename an existing note: pick a new vault, folder and title. */
export function MoveRoute() {
  const path = useParams()['*'] || '';
  // A snapshot, not a live query: the move deletes the note from the cache
  // before its commit returns, and the form must stay mounted to report errors.
  const note = useNoteSnapshot(path);

  if (note === undefined)
    return <p className="text-sm text-neutral-500 dark:text-neutral-400">Loading…</p>;
  if (note === null) {
    return (
      <div>
        <Link
          to="/"
          className="text-sm text-neutral-500 hover:text-neutral-700 dark:text-neutral-400"
        >
          ← Library
        </Link>
        <p className="mt-6 text-neutral-500">This note isn’t in the cache.</p>
      </div>
    );
  }
  // Keyed by path so the form re-seeds if the route changes to another note.
  return <MoveForm key={note.path} note={note} />;
}

function MoveForm({ note }: { note: NoteRecord }) {
  const navigate = useNavigate();
  const [now] = useState(() => new Date());
  const [fields, setFields] = useState<NoteLocationValue>(() => initialFields(note));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Don't let a service-worker update reload the page between the two commits.
  useHoldEditorGuard(busy);

  const pending = usePendingCount();
  const warningId = useId();

  const folders = useFolderOptions(fields.target === '_inbox' ? undefined : fields.target);
  const plan = planNewNote({ ...fields, now, knownFolders: folders });
  const toVault = plan.path ? pathMeta(plan.path).vault : note.vault;
  const sameVault = toVault === note.vault;

  // Links are only checked within the note's current vault (vaults are isolated).
  // Backlinks scan every body, so they're computed once, not per keystroke.
  const vaultNotes = useVaultNotes(note.vault);
  const corpus = useMemo(() => toResolvable(vaultNotes ?? []), [vaultNotes]);
  const linkers = useMemo(
    () => findBacklinks(note.path, note.vault, corpus),
    [note.path, note.vault, corpus],
  );
  const moving = plan.path !== null && plan.path !== note.path;
  const broken = useMemo(
    () => (moving && plan.path ? linksBrokenByMove(note.path, plan.path, corpus, linkers) : []),
    [moving, plan.path, note.path, corpus, linkers],
  );
  const destPaths = useVaultPaths(moving ? toVault : undefined);
  const twin = moving && plan.path ? namesake(plan.path, destPaths ?? [], note.path) : null;

  async function move() {
    if (busy) return;
    const client = currentClient();
    if (!client) return setError('Not connected. Add a token in Settings.');
    if (!plan.path) return setError(plan.problem ?? 'Add a title.');
    const to = plan.path;
    if (to !== note.path && to.toLowerCase() === note.path.toLowerCase()) {
      // GitHub would briefly hold both names, which collide on a macOS/Windows checkout.
      return setError('Only the capitalisation changed. Rename this one in Obsidian instead.');
    }
    // Moves are online-only (see moveNote).
    if (to !== note.path && !navigator.onLine) {
      return setError('You’re offline. Nothing was moved; try again when connected.');
    }
    if (to !== note.path && pending > 0) {
      return setError('Some changes are still waiting to sync. Try again once they have.');
    }
    if (!confirmVaultCrossing(note.vault, toVault)) return;
    const original = fullText(note);
    const text = composeMovedText(original, plan.fields);

    setBusy(true);
    setError(null);
    try {
      if (to === note.path) {
        // Same place: at most the Active flag or type changed — update in place.
        if (text !== original) {
          // `text` was built from the snapshot; refuse if the cache has moved on.
          if ((await db().notes.get(to))?.sha !== note.sha) throw new MoveSourceChangedError(to);
          await saveNoteText(client, db(), to, text);
        }
      } else {
        if (await isPathTaken(db(), to, note.path)) {
          setError(`${to} already exists. Pick another title or folder.`);
          setBusy(false);
          return;
        }
        await moveNote(client, db(), note.path, to, text, note.sha);
      }
      void navigate(notePathname(to), { replace: true });
    } catch (err) {
      setError(moveErrorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <button
          onClick={() => void navigate(notePathname(note.path))}
          className="text-sm text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
        >
          Cancel
        </button>
        <button
          onClick={() => void move()}
          disabled={busy}
          aria-describedby={warningId}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40 dark:bg-white dark:text-neutral-900"
        >
          {busy ? 'Moving…' : 'Move'}
        </button>
      </div>

      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        Moving <span className="font-mono break-all">{note.path}</span>
      </p>

      <NoteLocationFields
        action="move"
        value={fields}
        onChange={setFields}
        now={now}
        folders={folders}
      />

      {/* Always mounted so screen readers announce warnings as they appear. */}
      <div id={warningId} role="status" aria-live="polite">
        {(broken.length > 0 || twin || !sameVault) && (
          <div className="flex flex-col gap-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
            {broken.length > 0 && (
              <p>
                {broken.length === 1 ? '1 note links' : `${broken.length} notes link`} here and
                won’t find it after the move; their links aren’t updated automatically.
              </p>
            )}
            {twin && (
              <p>
                Another note is already named “{pathMeta(twin).filename}” ({twin}), so links by that
                name would no longer know which one you mean.
              </p>
            )}
            {!sameVault && (
              <p>
                Moving to another vault: images and links inside this note only resolve within its
                vault.
              </p>
            )}
          </div>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Personal and Work are kept apart on purpose, so moving between them asks
 * first: once committed, the content stays in the other vault's history even
 * if moved back. Filing to or from the inbox doesn't ask.
 */
function confirmVaultCrossing(from: string, to: string): boolean {
  const label: Record<string, string> = { w: 'Work', m: 'Personal' };
  const a = label[from];
  const b = label[to];
  if (!a || !b || a === b) return true;
  return window.confirm(
    `Move this note from ${a} to ${b}? The two vaults are kept separate; its content becomes part of ${b}, and stays in its history even if you move it back.`,
  );
}

/** User-facing text for a failed move; nothing here is ever silently retried. */
function moveErrorMessage(err: unknown): string {
  if (err instanceof MoveIncompleteError) {
    return `${err.message} ${describeError(err.cause)} Open both, check the copy is complete, then delete the original.`;
  }
  if (err instanceof GitHubError && err.kind === 'network') {
    return 'You’re offline. Nothing was moved; try again when connected.';
  }
  if (err instanceof MoveSourceChangedError) {
    return 'This note changed since you opened this screen, or has changes not synced yet. Nothing was moved; go back, sync and try again.';
  }
  if (err instanceof GitHubError && err.kind === 'conflict') {
    // Only the create can conflict here: the name exists on GitHub but not in this cache yet.
    return 'A note with that name already exists on GitHub. Nothing was moved; sync and pick another name.';
  }
  return describeError(err);
}

/**
 * Seed the form from the note's current location. Filing out of the inbox
 * starts with Active off, as /drain does: a filed note has stabilised.
 * A note outside the known vaults starts on Quick capture rather than a guess.
 */
function initialFields(note: NoteRecord): NoteLocationValue {
  const { vault, folder, filename } = pathMeta(note.path);
  const target: NewNoteTarget = vault === 'w' || vault === 'm' ? vault : '_inbox';
  const rel = target === '_inbox' ? '' : folder.slice(vault.length + 1);
  return {
    target,
    folder: rel,
    newFolder: false,
    title: filename,
    active: vault === '_inbox' ? false : note.active,
  };
}
