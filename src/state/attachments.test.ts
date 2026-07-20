import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, deleteDatabase, type AttachmentRecord } from '../lib/cache/db';
import { useSettings } from './settings';
import { ensureAttachmentDataUri } from './notes';

const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function att(path: string, sha: string): AttachmentRecord {
  return { path, sha, vault: 'r', filename: path.split('/').at(-1) ?? path, updatedAt: 0 };
}

beforeEach(async () => {
  await deleteDatabase();
  useSettings.getState().setToken('test-token');
});

afterEach(() => {
  vi.restoreAllMocks();
  useSettings.getState().forget();
});

describe('ensureAttachmentDataUri', () => {
  it('caches the data URI on every row sharing the blob SHA', async () => {
    // Two distinct paths, same content SHA (git blobs are content-addressed).
    await db().attachments.bulkPut([att('r/a/pic.png', 'shaX'), att('r/b/pic.png', 'shaX')]);

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ sha: 'shaX', encoding: 'base64', content: PNG_B64, size: 68 }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );

    const dataUri = await ensureAttachmentDataUri(att('r/a/pic.png', 'shaX'));
    expect(dataUri.startsWith('data:image/png;base64,')).toBe(true);

    // Both rows — not just the one requested — now carry the cached URI.
    expect((await db().attachments.get('r/a/pic.png'))?.dataUri).toBe(dataUri);
    expect((await db().attachments.get('r/b/pic.png'))?.dataUri).toBe(dataUri);
  });

  it('returns the cached URI without refetching', async () => {
    await db().attachments.put({
      ...att('r/a/pic.png', 'shaY'),
      dataUri: 'data:image/png;base64,AAAA',
    });
    const spy = vi.spyOn(globalThis, 'fetch');
    const uri = await ensureAttachmentDataUri(att('r/a/pic.png', 'shaY'));
    expect(uri).toBe('data:image/png;base64,AAAA');
    expect(spy).not.toHaveBeenCalled();
  });
});
