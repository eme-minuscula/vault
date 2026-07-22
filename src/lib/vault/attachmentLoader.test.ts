import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VaultDb, type AttachmentBlob } from '../cache/db';
import type { GitHubClient } from '../github/client';
import {
  BLOB_CACHE_MAX_BYTES,
  EVICTION_GRACE_MS,
  ensureAttachmentDataUri,
  evictBlobs,
} from './attachmentLoader';

const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

class FakeClient {
  fetches: string[] = [];
  getBlobBase64(sha: string): Promise<string> {
    this.fetches.push(sha);
    return Promise.resolve(PNG_B64);
  }
}
const asClient = (f: FakeClient) => f as unknown as GitHubClient;
const row = (sha: string, filename = 'pic.png') => ({ sha, filename });

let db: VaultDb;
beforeEach(async () => {
  db = new VaultDb();
  await db.clearAll();
});

afterEach(() => {
  vi.useRealTimers(); // don't leak a shifted clock into later tests
  db.close();
});

describe('ensureAttachmentDataUri', () => {
  it('fetches once and caches the bytes by content SHA', async () => {
    const fake = new FakeClient();
    const uri = await ensureAttachmentDataUri(asClient(fake), db, row('shaX'));
    expect(uri.startsWith('data:image/png;base64,')).toBe(true);
    expect((await db.attachmentBlobs.get('shaX'))?.dataUri).toBe(uri);

    // A second attachment at a different path with the same content re-uses it.
    const again = await ensureAttachmentDataUri(asClient(fake), db, row('shaX', 'copy.png'));
    expect(again).toBe(uri);
    expect(fake.fetches).toEqual(['shaX']); // no second fetch
  });

  it('does not fetch the same SHA twice concurrently', async () => {
    const fake = new FakeClient();
    const [a, b] = await Promise.all([
      ensureAttachmentDataUri(asClient(fake), db, row('shaY')),
      ensureAttachmentDataUri(asClient(fake), db, row('shaY')),
    ]);
    expect(a).toBe(b);
    expect(fake.fetches).toEqual(['shaY']);
  });

  it('keeps the metadata table free of image bytes', async () => {
    await db.attachments.put({
      path: 'r/a/pic.png',
      sha: 'shaZ',
      vault: 'r',
      filename: 'pic.png',
      updatedAt: 0,
    });
    await ensureAttachmentDataUri(asClient(new FakeClient()), db, row('shaZ'));

    // This is the point of the split: resolving embeds reads this table, so it
    // must stay small no matter how many images are cached.
    const meta = await db.attachments.get('r/a/pic.png');
    expect(JSON.stringify(meta)).not.toContain('data:image');
  });

  it('propagates a fetch failure instead of caching a broken entry', async () => {
    const failing = {
      getBlobBase64: () => Promise.reject(new Error('boom')),
    } as unknown as GitHubClient;
    await expect(ensureAttachmentDataUri(failing, db, row('shaBad'))).rejects.toThrow('boom');
    expect(await db.attachmentBlobs.get('shaBad')).toBeUndefined();
  });
});

describe('evictBlobs', () => {
  const blob = (sha: string, size: number, usedAt: number): AttachmentBlob => ({
    sha,
    dataUri: 'x',
    size,
    usedAt,
  });

  // `now` is far ahead of the fixtures' usedAt so they're all outside the grace window.
  const LATER = 10 * EVICTION_GRACE_MS;

  it('drops least-recently-used blobs until under budget', async () => {
    await db.attachmentBlobs.bulkPut([
      blob('old', 60, 1),
      blob('middle', 60, 2),
      blob('fresh', 60, 3),
    ]);
    const dropped = await evictBlobs(db, 130, LATER);
    expect(dropped).toBe(1); // 180 -> 120 by removing the oldest
    expect(await db.attachmentBlobs.get('old')).toBeUndefined();
    expect(await db.attachmentBlobs.get('fresh')).toBeDefined();
  });

  it('never evicts a recently-used blob, even when over budget', async () => {
    // Everything was just used — as when one note's embeds exceed the budget.
    // Evicting here would delete an on-screen image and trigger a refetch loop.
    const now = LATER;
    await db.attachmentBlobs.bulkPut([
      blob('a', 100, now - 1_000),
      blob('b', 100, now - 500),
      blob('c', 100, now),
    ]);
    const dropped = await evictBlobs(db, 150, now);
    expect(dropped).toBe(0);
    expect(await db.attachmentBlobs.count()).toBe(3);
  });

  it('stays correct when an LRU touch lands during eviction', async () => {
    // usedAt is the leading index component, so a touch *moves* a row. If the two
    // key cursors ran in separate transactions, the lists would misalign and we
    // could delete a blob based on another row's timestamp.
    const now = LATER;
    await db.attachmentBlobs.bulkPut([
      blob('oldest', 100, now - 10 * EVICTION_GRACE_MS),
      blob('older', 100, now - 9 * EVICTION_GRACE_MS),
      blob('recent', 100, now - 100),
    ]);

    const evicting = evictBlobs(db, 150, now);
    // Race a touch against it, exactly as a cache hit would.
    const touching = db.attachmentBlobs.update('older', { usedAt: now });
    const [dropped] = await Promise.all([evicting, touching]);

    // Whatever the interleaving, the freshly-used blob must survive and only
    // genuinely stale entries may go.
    expect(await db.attachmentBlobs.get('recent')).toBeDefined();
    expect(dropped).toBeGreaterThanOrEqual(1);
    const survivors = await db.attachmentBlobs.orderBy('sha').primaryKeys();
    expect(survivors).not.toContain('oldest'); // the true LRU victim
  });

  it('reads sizes without materializing any cached image bytes', async () => {
    // Guards the regression that made eviction load the whole cache into memory.
    await db.attachmentBlobs.bulkPut([blob('x', 10, 1), blob('y', 10, 2)]);
    const spy = vi.spyOn(db.attachmentBlobs, 'toArray');
    await evictBlobs(db, 5, LATER);
    expect(spy).not.toHaveBeenCalled();
  });

  it('does nothing while within budget', async () => {
    await db.attachmentBlobs.bulkPut([blob('a', 10, 1), blob('b', 10, 2)]);
    expect(await evictBlobs(db, 100)).toBe(0);
    expect(await db.attachmentBlobs.count()).toBe(2);
  });

  it('has a sane default budget', () => {
    expect(BLOB_CACHE_MAX_BYTES).toBeGreaterThan(1024 * 1024);
  });

  it('touches usedAt on a cache hit so re-read images survive eviction', async () => {
    const fake = new FakeClient();
    await ensureAttachmentDataUri(asClient(fake), db, row('shaT'));
    const before = (await db.attachmentBlobs.get('shaT'))?.usedAt ?? 0;

    vi.setSystemTime(new Date(Date.now() + 5_000));
    await ensureAttachmentDataUri(asClient(fake), db, row('shaT'));
    // The touch is fire-and-forget; let it land.
    await new Promise((r) => setTimeout(r, 0));

    expect((await db.attachmentBlobs.get('shaT'))?.usedAt ?? 0).toBeGreaterThan(before);
    vi.useRealTimers();
  });
});
