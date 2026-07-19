import type { GitHubClient } from '../github/client';
import type { VaultDb, NoteRecord } from '../cache/db';
import { parseNote } from '../frontmatter/parse';
import { splitDoc } from '../frontmatter/doc';
import { pathMeta, isMarkdown } from '../vault/path';
import { mapLimit } from './mapLimit';

const META_HEAD_SHA = 'headSha';
const META_BRANCH_ETAG = 'branchEtag';

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
  const report = (phase: SyncPhase, fetched: number, toFetch: number) =>
    opts.onProgress?.({ phase, fetched, toFetch });

  report('checking', 0, 0);
  const priorEtag = opts.force ? null : await database.getMeta(META_BRANCH_ETAG);
  const branch = await client.getBranch(priorEtag);

  if (branch.notModified) {
    report('up-to-date', 0, 0);
    return {
      changed: 0,
      removed: 0,
      upToDate: true,
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
    if (ignored.some((prefix) => entry.path.startsWith(prefix))) continue;
    desired.set(entry.path, entry.sha);
  }

  const existing = new Map<string, string>();
  await database.notes.each((n) => existing.set(n.path, n.sha));

  const toFetch: string[] = [];
  for (const [path, sha] of desired) {
    if (existing.get(path) !== sha) toFetch.push(path);
  }
  const toDelete: string[] = [];
  if (!truncated) {
    for (const path of existing.keys()) {
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
  const records = await mapLimit(toFetch, FETCH_CONCURRENCY, async (path) => {
    const sha = desired.get(path)!;
    const raw = await client.getBlobText(sha);
    const record = toRecord(path, sha, raw);
    fetched += 1;
    report('fetching', fetched, toFetch.length);
    return record;
  });

  if (records.length) await database.notes.bulkPut(records);

  // Only advance the sync watermark on a complete tree, so a truncated sync retries.
  if (!truncated) {
    if (headSha) await database.setMeta(META_HEAD_SHA, headSha);
    if (branch.etag) await database.setMeta(META_BRANCH_ETAG, branch.etag);
  }

  report('done', fetched, toFetch.length);
  return {
    changed: records.length,
    removed: toDelete.length,
    upToDate: false,
    headSha,
    truncated,
  };
}

export function toRecord(path: string, sha: string, raw: string): NoteRecord {
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
    active: parsed.frontmatter.active,
    date: parsed.frontmatter.date,
    snippet: parsed.snippet,
    frontmatter,
    body,
    updatedAt: Date.now(),
  };
}
