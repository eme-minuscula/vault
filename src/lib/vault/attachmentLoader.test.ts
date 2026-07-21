import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VaultDb, type AttachmentBlob } from '../cache/db';
import type { GitHubClient } from '../github/client';
import { BLOB_CACHE_MAX_BYTES, ensureAttachmentDataUri, evictBlobs } from './attachmentLoader';

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

  it('drops least-recently-used blobs until under budget', async () => {
    await db.attachmentBlobs.bulkPut([
      blob('old', 60, 1),
      blob('middle', 60, 2),
      blob('fresh', 60, 3),
    ]);
    const dropped = await evictBlobs(db, 130);
    expect(dropped).toBe(1); // 180 -> 120 by removing the oldest
    expect(await db.attachmentBlobs.get('old')).toBeUndefined();
    expect(await db.attachmentBlobs.get('fresh')).toBeDefined();
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
