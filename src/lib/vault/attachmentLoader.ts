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

/** Cap on cached image bytes. Generous for a personal vault, bounded on a phone. */
export const BLOB_CACHE_MAX_BYTES = 40 * 1024 * 1024;

// In-flight loads keyed by SHA, so the same image is never fetched twice at once.
const inFlight = new Map<string, Promise<string>>();

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

  const existing = inFlight.get(row.sha);
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

  inFlight.set(row.sha, load);
  try {
    return await load;
  } finally {
    inFlight.delete(row.sha);
  }
}

/** Drop least-recently-used blobs until the cache is back within budget. */
export async function evictBlobs(db: VaultDb, maxBytes = BLOB_CACHE_MAX_BYTES): Promise<number> {
  let total = 0;
  await db.attachmentBlobs.each((b) => {
    total += b.size;
  });
  if (total <= maxBytes) return 0;

  // Oldest first; stop as soon as we're under budget.
  const byAge = await db.attachmentBlobs.orderBy('usedAt').toArray();
  const doomed: string[] = [];
  for (const blob of byAge) {
    if (total <= maxBytes) break;
    doomed.push(blob.sha);
    total -= blob.size;
  }
  if (doomed.length) await db.attachmentBlobs.bulkDelete(doomed);
  return doomed.length;
}
