import type { GitHubClient } from '../github/client';
import { GitHubError } from '../github/errors';
import { type VaultDb, type NoteRecord, fullText } from '../cache/db';
import { toRecord } from '../sync/sync';
import { setActiveFlag } from '../frontmatter/doc';

/**
 * Note write operations.
 *
 * Every write updates the local cache optimistically, then commits to GitHub.
 * If the network is unavailable the write is queued in the outbox and flushed
 * later; a genuine API error (bad token, conflict) rolls the optimistic change
 * back so the cache never diverges silently. GitHub's own `sha` check gives us
 * optimistic-concurrency: a stale edit surfaces as a `conflict` for the UI.
 */

export interface SaveResult {
  /** True when the write was queued offline rather than committed now. */
  queued: boolean;
}

async function replacePendingPut(db: VaultDb, path: string): Promise<void> {
  // Keep at most one pending op per path (last-write-wins while offline).
  await db.outbox.where('path').equals(path).delete();
}

export async function saveNoteText(
  client: GitHubClient,
  db: VaultDb,
  path: string,
  text: string,
  opts: { create?: boolean; message?: string } = {},
): Promise<SaveResult> {
  const existing = await db.notes.get(path);
  const baseSha = opts.create ? undefined : existing?.sha;
  const message = opts.message ?? `vault: ${opts.create ? 'create' : 'update'} ${path}`;

  // Optimistic cache write (keep the old sha until the server assigns a new one).
  await db.notes.put(toRecord(path, existing?.sha ?? '', text));

  try {
    const res = await client.putFile(path, { message, text, sha: baseSha });
    const newSha = res.content?.sha ?? existing?.sha ?? '';
    await db.notes.put(toRecord(path, newSha, text));
    return { queued: false };
  } catch (err) {
    if (err instanceof GitHubError && err.kind === 'network') {
      await replacePendingPut(db, path);
      await db.outbox.add({ op: 'put', path, message, text, baseSha, createdAt: Date.now() });
      return { queued: true };
    }
    // Roll the optimistic change back on a real failure.
    if (existing) await db.notes.put(existing);
    else await db.notes.delete(path);
    throw err;
  }
}

export async function deleteNote(
  client: GitHubClient,
  db: VaultDb,
  path: string,
  opts: { message?: string } = {},
): Promise<SaveResult> {
  const existing = await db.notes.get(path);
  if (!existing) return { queued: false };
  const message = opts.message ?? `vault: delete ${path}`;

  await db.notes.delete(path); // optimistic

  try {
    await client.deleteFile(path, { message, sha: existing.sha });
    return { queued: false };
  } catch (err) {
    if (err instanceof GitHubError && err.kind === 'network') {
      await replacePendingPut(db, path);
      await db.outbox.add({
        op: 'delete',
        path,
        message,
        baseSha: existing.sha,
        createdAt: Date.now(),
      });
      return { queued: true };
    }
    await db.notes.put(existing); // rollback
    throw err;
  }
}

export async function setNoteActive(
  client: GitHubClient,
  db: VaultDb,
  note: NoteRecord,
  active: boolean,
): Promise<SaveResult> {
  const current = fullText(note);
  const next = setActiveFlag(current, active);
  if (next === current) return { queued: false };
  return saveNoteText(client, db, note.path, next, {
    create: false,
    message: `vault: ${active ? 'activate' : 'archive'} ${note.path}`,
  });
}

/**
 * Flush queued writes in order. Stops at the first still-offline op (leaving it
 * queued) and at the first hard error (conflict/auth) so it can be surfaced.
 */
export async function flushOutbox(
  client: GitHubClient,
  db: VaultDb,
): Promise<{ flushed: number; remaining: number; error?: GitHubError }> {
  const ops = await db.outbox.orderBy('id').toArray();
  let flushed = 0;
  let error: GitHubError | undefined;

  for (const op of ops) {
    try {
      if (op.op === 'put') {
        const res = await client.putFile(op.path, {
          message: op.message,
          text: op.text ?? '',
          sha: op.baseSha,
        });
        const newSha = res.content?.sha;
        if (newSha) await db.notes.put(toRecord(op.path, newSha, op.text ?? ''));
      } else {
        await client.deleteFile(op.path, { message: op.message, sha: op.baseSha ?? '' });
      }
      if (op.id !== undefined) await db.outbox.delete(op.id);
      flushed += 1;
    } catch (err) {
      if (err instanceof GitHubError && err.kind === 'network') break; // still offline
      if (err instanceof GitHubError) error = err;
      break;
    }
  }

  const remaining = await db.outbox.count();
  return { flushed, remaining, error };
}
