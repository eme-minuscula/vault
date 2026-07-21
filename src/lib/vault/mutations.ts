import { decodeBase64Utf8, type GitHubClient } from '../github/client';
import { GitHubError } from '../github/errors';
import { type VaultDb, type NoteRecord, type OutboxOp, fullText } from '../cache/db';
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
  // Normalize the "no base" sentinel: an offline-created note is cached with
  // sha '', and treating that as a real base SHA would queue writes GitHub can
  // never satisfy. `undefined` consistently means "this file isn't on the repo".
  const baseSha = opts.create ? undefined : existing?.sha || undefined;
  const message = opts.message ?? `vault: ${opts.create ? 'create' : 'update'} ${path}`;

  // Optimistic cache write. It necessarily carries the *pre-edit* SHA (the new one
  // isn't known yet), so mark it dirty: if this process dies before the commit is
  // confirmed, sync would otherwise see a matching SHA and never repair the note.
  await db.notes.put(toRecord(path, existing?.sha ?? '', text, { dirty: true }));

  try {
    const res = await client.putFile(path, { message, text, sha: baseSha });
    // Only a server-assigned SHA counts as confirmation. If the response somehow
    // lacks one, stay dirty rather than recreating the exact edited-text-with-
    // stale-SHA state this marker exists to prevent.
    const confirmed = res.content?.sha;
    await db.notes.put(
      toRecord(path, confirmed ?? existing?.sha ?? '', text, { dirty: !confirmed }),
    );
    // This write supersedes anything queued for the path. Leaving a stale op there
    // would replay against an out-of-date base SHA, 409 on flush, jam the outbox,
    // and pin the path in protectedPaths — shielding it from sync indefinitely.
    await replacePendingPut(db, path);
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

  // If this note was created offline and never reached the server, deleting it
  // is a no-op remotely — just cancel the queued create instead of queueing a
  // delete against a non-existent file (which would jam the outbox).
  // `!o.baseSha` covers both sentinels: a create queued with `undefined`, and a
  // follow-up edit of that offline-created note, whose base was the cached ''.
  const pending = await db.outbox.where('path').equals(path).toArray();
  if (pending.some((o) => o.op === 'put' && !o.baseSha)) {
    await db.outbox.where('path').equals(path).delete();
    return { queued: false };
  }

  try {
    await client.deleteFile(path, { message, sha: existing.sha });
    // Supersedes anything still queued for this path (see saveNoteText).
    await replacePendingPut(db, path);
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

      // A conflict on a replayed put often means the write already landed and we
      // died before clearing the op. If the repo already holds exactly this text,
      // the op is redundant — drop it and keep going rather than jamming the queue.
      if (err instanceof GitHubError && err.kind === 'conflict' && op.op === 'put') {
        const settled = await alreadyApplied(client, db, op);
        if (settled) {
          if (op.id !== undefined) await db.outbox.delete(op.id);
          flushed += 1;
          continue;
        }
      }

      if (err instanceof GitHubError) error = err;
      break;
    }
  }

  const remaining = await db.outbox.count();
  return { flushed, remaining, error };
}

/**
 * True when the repo already contains exactly the text this queued put wanted to
 * write — i.e. the commit landed but the op wasn't cleared. Refreshes the cache
 * with the real SHA so the note stops looking unconfirmed.
 */
async function alreadyApplied(client: GitHubClient, db: VaultDb, op: OutboxOp): Promise<boolean> {
  try {
    const remote = await client.getContent(op.path);
    if (decodeBase64Utf8(remote.content) !== (op.text ?? '')) return false;
    await db.notes.put(toRecord(op.path, remote.sha, op.text ?? ''));
    return true;
  } catch {
    // Can't confirm (missing, offline, denied) — treat as a genuine conflict.
    return false;
  }
}
