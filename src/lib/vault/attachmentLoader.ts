import type { GitHubClient } from '../github/client';
import type { AttachmentRecord, VaultDb } from '../cache/db';
import { endInFlight, flightKey, getInFlight, isInFlight, setInFlight } from '../inFlightRegistry';
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
 * strings as UTF-16, so the on-disk footprint is roughly twice this.
 *
 * The cap is soft: blobs inside the grace window below are never evicted, so a
 * single note whose embeds exceed the budget will sit over it until they age
 * out. That's the intended trade — a temporarily oversized cache is much better
 * than evicting an image that is still on screen and refetching it in a loop.
 */
export const BLOB_CACHE_MAX_BYTES = 40 * 1024 * 1024;

/**
 * Blobs touched more recently than this are never evicted. Without it, a note
 * whose embeds exceed the budget would evict an image that is still on screen,
 * and the live query would immediately re-fetch it — an endless request loop.
 */
export const EVICTION_GRACE_MS = 60_000;

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

  const key = flightKey(db.name, row.sha);
  const existing = getInFlight(key);
  if (existing) return existing;

  const load = (async () => {
    const base64 = await client.getBlobBase64(row.sha);
    const dataUri = `data:${mimeFor(row.filename)};base64,${base64}`;
    // The database may have been wiped while we were fetching ("Disconnect &
    // clear cache"). Writing now would resurrect private bytes into a cache the
    // user just cleared, so drop the result instead.
    if (!isInFlight(key)) return dataUri;
    await db.attachmentBlobs.put({
      sha: row.sha,
      dataUri,
      size: dataUri.length,
      usedAt: Date.now(),
    });
    await evictBlobs(db);
    return dataUri;
  })();

  setInFlight(key, load);
  try {
    return await load;
  } finally {
    endInFlight(key);
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
  // One transaction around both cursors and the delete. `.keys()` and
  // `.primaryKeys()` are separate operations, and `usedAt` is the leading index
  // component — so an LRU touch landing between them would reorder the index and
  // misalign the two lists, letting us delete a blob based on another row's
  // timestamp (including one inside the grace window, still on screen).
  return db.transaction('rw', db.attachmentBlobs, async () => {
    const keys = (await db.attachmentBlobs.orderBy('[usedAt+size]').keys()) as unknown as [
      number,
      number,
    ][];
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
  });
}
