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

/** Ids of the ops queued for `path` right now — the ones a write about to be
 * issued will supersede. Anything queued *later* is a newer edit and must survive. */
async function pendingOpIds(db: VaultDb, path: string): Promise<number[]> {
  return (await db.outbox.where('path').equals(path).primaryKeys()) as number[];
}

export async function saveNoteText(
  client: GitHubClient,
  db: VaultDb,
  path: string,
  text: string,
  opts: { create?: boolean; message?: string } = {},
): Promise<SaveResult> {
  const existing = await db.notes.get(path);
  // Normalize the "no base" sentinel. An offline-created note is cached with
  // sha '', and `''` and `undefined` must mean the same thing — "this file isn't
  // on the repo yet" — so the create-cancel check below can recognise both. (The
  // wire was never at risk: putFile already omits a falsy sha.)
  const baseSha = opts.create ? undefined : existing?.sha || undefined;
  const message = opts.message ?? `vault: ${opts.create ? 'create' : 'update'} ${path}`;
  // Snapshot before issuing the request — see pendingOpIds.
  const superseded = await pendingOpIds(db, path);

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
    // This write supersedes the ops that were queued when it was issued. Leaving
    // a stale op would replay against an out-of-date base SHA, 409 on flush, jam
    // the outbox, and pin the path in protectedPaths — shielding it from sync
    // indefinitely. Only the snapshot is cleared: an edit queued while this
    // request was in flight is newer than us and must survive.
    await db.outbox.bulkDelete(superseded);
    return { queued: false };
  } catch (err) {
    if (err instanceof GitHubError && err.kind === 'network') {
      await db.outbox.bulkDelete(superseded);
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
    // The note never reached the repo, so every queued op for it is moot.
    await db.outbox.where('path').equals(path).delete();
    return { queued: false };
  }

  // No SHA and no pending create means there's nothing on the repo to delete
  // (e.g. a create that flushed without a confirmed SHA). Removing it locally is
  // the whole job; queueing a SHA-less delete would only 422 and jam the outbox.
  if (!existing.sha) return { queued: false };

  const superseded = await pendingOpIds(db, path);

  try {
    await client.deleteFile(path, { message, sha: existing.sha });
    // Supersedes the ops queued when this delete was issued (see saveNoteText).
    await db.outbox.bulkDelete(superseded);
    return { queued: false };
  } catch (err) {
    if (err instanceof GitHubError && err.kind === 'network') {
      await db.outbox.bulkDelete(superseded);
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
    // `ops` is a snapshot; an op cancelled while we were flushing (superseded by a
    // newer write, or a delete that cancelled a create) must not be replayed — a
    // create-shaped op omits the sha and would overwrite unconditionally.
    if (op.id !== undefined && !(await db.outbox.get(op.id))) continue;
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

      // A conflict on a replay usually means the intent is already satisfied and
      // we died before clearing the op. Rather than jamming the queue forever,
      // check whether the repo already reflects it — and drop the op if so.
      if (err instanceof GitHubError && err.kind === 'conflict') {
        const settled =
          op.op === 'put' ? await alreadyApplied(client, db, op) : await alreadyDeleted(client, op);
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
    // Files over ~1MB come back as `encoding: "none"` with empty content, which
    // would false-match a queued empty note. Only trust a real base64 payload.
    if (remote.encoding !== 'base64') return false;
    if (decodeBase64Utf8(remote.content) !== (op.text ?? '')) return false;
    await db.notes.put(toRecord(op.path, remote.sha, op.text ?? ''));
    return true;
  } catch {
    // Can't confirm (missing, offline, denied) — treat as a genuine conflict.
    return false;
  }
}

/**
 * True when the file a queued delete targets is already gone from the repo, so
 * the op is redundant. Without this, a delete that conflicts (the file changed
 * remotely between queueing and flush) jams the queue forever — the same failure
 * this module closes for puts.
 */
async function alreadyDeleted(client: GitHubClient, op: OutboxOp): Promise<boolean> {
  try {
    await client.getContent(op.path);
    return false; // still there → a real conflict
  } catch (err) {
    return err instanceof GitHubError && err.kind === 'not-found';
  }
}
