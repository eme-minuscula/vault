import type { GitHubClient } from '../github/client';
import type { AttachmentRecord, VaultDb } from '../cache/db';
import { mimeFor } from './attachments';

/**
 * Fetching and caching of attachment bytes.
 *
 * Lives in `lib/` alongside the other operations that take an explicit client +
 * db (see mutations.ts): it does network and storage work, so it isn't a hook.
 * `state/notes.ts` wraps it for React.
 *
 * Bytes are cached as data URIs keyed by git blob SHA — content-addressed, so
 * the same image at two paths is stored once — and bounded by an LRU budget so a
 * large image vault can't exhaust the device's storage quota.
 */

/**
 * Cap on cached image bytes. Measured in data-URI characters; IndexedDB stores
 * strings as UTF-16, so the on-disk footprint is roughly twice this. Generous
 * for a personal vault, bounded on a phone.
 */
export const BLOB_CACHE_MAX_BYTES = 40 * 1024 * 1024;

/**
 * Blobs touched more recently than this are never evicted. Without it, a note
 * whose embeds exceed the budget would evict an image that is still on screen,
 * and the live query would immediately re-fetch it — an endless request loop.
 */
export const EVICTION_GRACE_MS = 60_000;

// In-flight loads, keyed by database *and* SHA: two VaultDb instances (or a
// wipe-and-recreate) must not share entries, or bytes from a load started before
// "Disconnect & clear cache" could land in the freshly cleared database.
const inFlight = new Map<string, Promise<string>>();

const flightKey = (db: VaultDb, sha: string) => `${db.name}:${sha}`;

/** Abandon in-flight loads for a database — called when its contents are wiped. */
export function clearInFlight(db: { name: string }): void {
  for (const key of [...inFlight.keys()]) {
    if (key.startsWith(`${db.name}:`)) inFlight.delete(key);
  }
}

/** Cached data URI for an attachment, fetching and storing it on first use. */
export async function ensureAttachmentDataUri(
  client: GitHubClient,
  db: VaultDb,
  row: Pick<AttachmentRecord, 'sha' | 'filename'>,
): Promise<string> {
  const cached = await db.attachmentBlobs.get(row.sha);
  if (cached) {
    // Touch for LRU; not awaited, it must not delay painting the image.
    void db.attachmentBlobs.update(row.sha, { usedAt: Date.now() });
    return cached.dataUri;
  }

  const key = flightKey(db, row.sha);
  const existing = inFlight.get(key);
  if (existing) return existing;

  const load = (async () => {
    const base64 = await client.getBlobBase64(row.sha);
    const dataUri = `data:${mimeFor(row.filename)};base64,${base64}`;
    await db.attachmentBlobs.put({
      sha: row.sha,
      dataUri,
      size: dataUri.length,
      usedAt: Date.now(),
    });
    await evictBlobs(db);
    return dataUri;
  })();

  inFlight.set(key, load);
  try {
    return await load;
  } finally {
    inFlight.delete(key);
  }
}

/**
 * Drop least-recently-used blobs until the cache is back within budget.
 *
 * Reads sizes and SHAs from indexes only — never materializing a `dataUri` —
 * because this runs on every image insert, and loading the whole cache here
 * would recreate the very problem the split table exists to solve.
 */
export async function evictBlobs(
  db: VaultDb,
  maxBytes = BLOB_CACHE_MAX_BYTES,
  now = Date.now(),
): Promise<number> {
  // Both scans walk the same [usedAt+size] index in the same order, so entry i
  // of each refers to the same row. Key-only cursors: no values are read.
  const ordered = db.attachmentBlobs.orderBy('[usedAt+size]');
  const keys = (await ordered.keys()) as unknown as [number, number][];
  let total = 0;
  for (const [, size] of keys) total += size;
  if (total <= maxBytes) return 0;

  const shas = await db.attachmentBlobs.orderBy('[usedAt+size]').primaryKeys();

  const doomed: string[] = [];
  for (let i = 0; i < keys.length && total > maxBytes; i++) {
    const entry = keys[i];
    const sha = shas[i];
    if (!entry || sha === undefined) break;
    const [usedAt, size] = entry;
    // Ascending by usedAt, so once we reach a recently-used blob everything
    // after it is newer too — stop rather than evict something on screen.
    if (usedAt > now - EVICTION_GRACE_MS) break;
    doomed.push(sha);
    total -= size;
  }

  if (doomed.length) await db.attachmentBlobs.bulkDelete(doomed);
  return doomed.length;
}
