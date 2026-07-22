import type { GitHubClient } from '../github/client';
import type { VaultDb, NoteRecord, AttachmentRecord } from '../cache/db';
import { parseNote } from '../frontmatter/parse';
import { splitDoc } from '../frontmatter/doc';
import { pathMeta, isMarkdown, isExcludedPath } from '../vault/path';
import { isImagePath } from '../vault/attachments';
import { mapLimit } from './mapLimit';

const META_HEAD_SHA = 'headSha';
const META_BRANCH_ETAG = 'branchEtag';
const META_EXCLUDED_CLEANUP = 'excludedCleanup:v1';

/** Bounded concurrency for blob fetches — polite to the API and to mobile networks. */
const FETCH_CONCURRENCY = 6;

export type SyncPhase = 'checking' | 'listing' | 'fetching' | 'pruning' | 'done' | 'up-to-date';

export interface SyncProgress {
  phase: SyncPhase;
  fetched: number;
  toFetch: number;
}

export interface SyncResult {
  changed: number;
  removed: number;
  upToDate: boolean;
  headSha: string | null;
  /** True if GitHub truncated the tree response — the sync is intentionally partial. */
  truncated: boolean;
}

export interface SyncOptions {
  /** Path prefixes to exclude from the cache (e.g. bulky auto-synced transcripts). */
  ignoredPrefixes?: readonly string[];
  /** Force a full reconcile even if the branch ETag says nothing changed. */
  force?: boolean;
  /**
   * Paths with a still-pending offline write. They are shielded from prune and
   * from refetch/overwrite so the reconcile pass never clobbers a local write
   * that hasn't reached GitHub yet.
   */
  protectedPaths?: ReadonlySet<string>;
  onProgress?: (p: SyncProgress) => void;
}

/**
 * Reconcile the local cache with the repo.
 *
 * Steady-state cost is deliberately low: a single conditional branch request
 * returns 304 when nothing changed. When something did change, we pull the
 * recursive tree once and fetch only the blobs whose SHA differs from the cache
 * (blob SHAs are immutable, so unchanged files are never re-downloaded).
 */
export async function syncVault(
  client: GitHubClient,
  database: VaultDb,
  opts: SyncOptions = {},
): Promise<SyncResult> {
  const ignored = opts.ignoredPrefixes ?? [];
  const protectedPaths = opts.protectedPaths ?? new Set<string>();
  const report = (phase: SyncPhase, fetched: number, toFetch: number) =>
    opts.onProgress?.({ phase, fetched, toFetch });

  report('checking', 0, 0);

  // One-time purge of anything now excluded (e.g. previously-cached .stversions
  // backups or a Creds.md). Runs regardless of the ETag short-circuit below, so
  // tightened rules take effect on the next sync without a full re-sync.
  if (!(await database.getMeta(META_EXCLUDED_CLEANUP))) {
    await database.notes.filter((n) => isExcludedPath(n.path)).delete();
    await database.setMeta(META_EXCLUDED_CLEANUP, '1');
  }

  const priorEtag = opts.force ? null : await database.getMeta(META_BRANCH_ETAG);
  const branch = await client.getBranch(priorEtag);

  if (branch.notModified) {
    // A 304 means the repo is unchanged — which is exactly the situation where a
    // lost local write would otherwise never be reconciled, since the delta pass
    // below never runs. Repair those here before short-circuiting.
    const { repaired, removed } = await repairUnconfirmed(client, database, protectedPaths, report);
    report('up-to-date', 0, 0);
    return {
      changed: repaired,
      removed,
      upToDate: repaired === 0 && removed === 0,
      headSha: await database.getMeta(META_HEAD_SHA),
      truncated: false,
    };
  }

  const headSha = branch.data?.commit.sha ?? null;
  const treeSha = branch.data?.commit.commit.tree.sha;
  if (!treeSha) throw new Error('Branch response missing tree SHA');

  report('listing', 0, 0);
  const tree = await client.getTree(treeSha);

  // If GitHub truncated the tree, `desired` is incomplete. We must NOT prune
  // (omitted paths would look deleted) and must NOT persist the new head/etag
  // (that would make the next sync short-circuit on a partial state). We still
  // fetch what we did receive. The real vault is far under the truncation limit.
  const truncated = tree.truncated;

  // Desired state: markdown blobs not under an ignored prefix.
  const desired = new Map<string, string>(); // path -> blob sha
  for (const entry of tree.tree) {
    if (entry.type !== 'blob' || !isMarkdown(entry.path)) continue;
    if (isExcludedPath(entry.path)) continue;
    if (ignored.some((prefix) => entry.path.startsWith(prefix))) continue;
    desired.set(entry.path, entry.sha);
  }

  const existing = new Map<string, string>();
  // Records holding an unconfirmed local edit. They still carry the pre-edit SHA,
  // so a plain SHA comparison would call them up to date forever if the write was
  // lost (tab closed, reload, crash). Re-fetch them to reconcile with the repo.
  const unconfirmed = new Set<string>();
  await database.notes.each((n) => {
    existing.set(n.path, n.sha);
    if (n.dirty) unconfirmed.add(n.path);
  });

  const toFetch: string[] = [];
  for (const [path, sha] of desired) {
    // A path with a queued offline write is authoritative locally until it flushes.
    if (protectedPaths.has(path)) continue;
    if (existing.get(path) !== sha || unconfirmed.has(path)) toFetch.push(path);
  }
  const toDelete: string[] = [];
  if (!truncated) {
    for (const path of existing.keys()) {
      if (protectedPaths.has(path)) continue; // don't prune a note with a pending write
      if (!desired.has(path)) toDelete.push(path);
    }
  }

  // Prune removed notes first so the cache never holds orphans.
  if (toDelete.length) {
    report('pruning', 0, toFetch.length);
    await database.notes.bulkDelete(toDelete);
  }

  let fetched = 0;
  report('fetching', 0, toFetch.length);
  const entries = await mapLimit(toFetch, FETCH_CONCURRENCY, async (path) => {
    const sha = desired.get(path)!;
    const raw = await client.getBlobText(sha);
    fetched += 1;
    report('fetching', fetched, toFetch.length);
    return {
      record: toRecord(path, sha, raw),
      expectedSha: existing.get(path),
      expectedDirty: unconfirmed.has(path),
    };
  });

  const written = await putIfUnchanged(database, entries);

  // Index image attachments (metadata only — the bytes are fetched lazily on
  // display). Cheap: no blob downloads happen here.
  await indexAttachments(database, tree.tree, ignored, truncated);

  // Only advance the sync watermark on a complete tree, so a truncated sync retries.
  if (!truncated) {
    if (headSha) await database.setMeta(META_HEAD_SHA, headSha);
    if (branch.etag) await database.setMeta(META_BRANCH_ETAG, branch.etag);
  }

  report('done', fetched, toFetch.length);
  return {
    changed: written,
    removed: toDelete.length,
    upToDate: false,
    headSha,
    truncated,
  };
}

/**
 * Reconcile notes holding an unconfirmed local write, without a tree pass.
 *
 * Only valid when the branch reported 304: that proves blob SHAs are unchanged,
 * so a dirty record's (pre-edit) SHA is still the repo's current SHA and can be
 * re-fetched directly — one blob request per affected note, no tree request.
 *
 * Paths with a queued offline write are skipped: they are locally authoritative
 * until the outbox flushes. A dirty record with no SHA was created offline and
 * never reached the repo, so if it is no longer queued it is dropped.
 */
async function repairUnconfirmed(
  client: GitHubClient,
  database: VaultDb,
  protectedPaths: ReadonlySet<string>,
  report: (phase: SyncPhase, fetched: number, toFetch: number) => void,
): Promise<{ repaired: number; removed: number }> {
  const dirty = (await database.notes.where('dirty').equals(1).toArray()).filter(
    (n) => !protectedPaths.has(n.path),
  );
  if (dirty.length === 0) return { repaired: 0, removed: 0 };

  const orphans = dirty.filter((n) => !n.sha).map((n) => n.path);
  if (orphans.length) await database.notes.bulkDelete(orphans);

  const recoverable = dirty.filter((n) => n.sha);
  let done = 0;
  report('fetching', 0, recoverable.length);
  const entries = await mapLimit(recoverable, FETCH_CONCURRENCY, async (note) => {
    const raw = await client.getBlobText(note.sha);
    done += 1;
    report('fetching', done, recoverable.length);
    return {
      record: toRecord(note.path, note.sha, raw),
      expectedSha: note.sha,
      expectedDirty: true,
    };
  });
  const repaired = await putIfUnchanged(database, entries);

  return { repaired, removed: orphans.length };
}

/**
 * Write fetched records, skipping any note that changed underneath us while the
 * fetch was in flight (i.e. the user saved it). Without this, a reconcile could
 * overwrite a just-confirmed local save with the older repo text — recoverable,
 * but the user would watch their edit vanish. Anything skipped is reconciled by
 * the next sync, which will see the newer SHA.
 */
async function putIfUnchanged(
  database: VaultDb,
  entries: readonly {
    record: NoteRecord;
    /** SHA observed before the fetch; undefined when the note wasn't cached yet. */
    expectedSha: string | undefined;
    expectedDirty: boolean;
  }[],
): Promise<number> {
  if (entries.length === 0) return 0;
  let written = 0;
  await database.transaction('rw', database.notes, async () => {
    for (const { record, expectedSha, expectedDirty } of entries) {
      const current = await database.notes.get(record.path);
      if (current) {
        // Appeared, or was re-saved, while we were fetching → leave it alone.
        if (expectedSha === undefined) continue;
        if (current.sha !== expectedSha || (current.dirty === 1) !== expectedDirty) continue;
      }
      await database.notes.put(record);
      written += 1;
    }
  });
  return written;
}

/** Reconcile the image-attachment index against the current tree (metadata only). */
async function indexAttachments(
  database: VaultDb,
  tree: { path: string; type: string; sha: string }[],
  ignored: readonly string[],
  truncated: boolean,
): Promise<void> {
  const desired = new Map<string, string>();
  for (const entry of tree) {
    if (entry.type !== 'blob' || !isImagePath(entry.path)) continue;
    if (isExcludedPath(entry.path)) continue;
    if (ignored.some((prefix) => entry.path.startsWith(prefix))) continue;
    desired.set(entry.path, entry.sha);
  }

  const existing = new Map<string, string>();
  await database.attachments.each((a) => existing.set(a.path, a.sha));

  // Changed/new: re-index (drops any stale cached dataUri by omitting it).
  const toPut: AttachmentRecord[] = [];
  for (const [path, sha] of desired) {
    if (existing.get(path) === sha) continue;
    const { vault } = pathMeta(path);
    toPut.push({
      path,
      sha,
      vault,
      filename: path.split('/').at(-1) ?? path,
      updatedAt: Date.now(),
    });
  }

  const toDelete: string[] = [];
  if (!truncated) {
    for (const path of existing.keys()) if (!desired.has(path)) toDelete.push(path);
  }

  if (toDelete.length) await database.attachments.bulkDelete(toDelete);
  if (toPut.length) await database.attachments.bulkPut(toPut);

  // Drop cached bytes no metadata row references any more (image deleted or
  // replaced upstream). Otherwise they'd linger until LRU pressure — possibly
  // never, while under budget. Key-only scan: no dataUri is materialized.
  if (!truncated) {
    const live = new Set(desired.values());
    const cached = await database.attachmentBlobs.orderBy('sha').primaryKeys();
    const orphans = cached.filter((sha) => !live.has(sha));
    if (orphans.length) await database.attachmentBlobs.bulkDelete(orphans);
  }
}

/**
 * Build a cache record from raw note text.
 *
 * Pass `dirty: true` for an optimistic local write whose commit hasn't been
 * confirmed yet — sync uses that marker to re-fetch the note if the write is
 * lost, since the record still carries the pre-edit SHA.
 */
export function toRecord(
  path: string,
  sha: string,
  raw: string,
  opts: { dirty?: boolean } = {},
): NoteRecord {
  const parsed = parseNote(raw);
  const { frontmatter, body } = splitDoc(raw);
  const { vault, folder, filename } = pathMeta(path);
  return {
    path,
    sha,
    vault,
    folder,
    title: parsed.heading ?? filename,
    type: parsed.frontmatter.type,
    tags: parsed.frontmatter.tags,
    aliases: parsed.frontmatter.aliases,
    active: parsed.frontmatter.active,
    date: parsed.frontmatter.date,
    snippet: parsed.snippet,
    frontmatter,
    body,
    updatedAt: Date.now(),
    ...(opts.dirty ? { dirty: 1 as const } : {}),
  };
}
