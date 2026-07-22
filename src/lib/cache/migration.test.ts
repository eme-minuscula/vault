import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { VaultDb } from './db';

/**
 * The v6 upgrade is the only code path that rewrites data an existing user
 * already has on disk, so it gets its own test: everything else in the suite
 * starts from a fresh database.
 */

const NAME = 'vault-cache';

afterEach(async () => {
  await Dexie.delete(NAME);
});

/** The v5 schema, as shipped before image bytes were split out. */
function openV5(): Dexie {
  const legacy = new Dexie(NAME);
  legacy.version(5).stores({
    notes: 'path, vault, type, date, dirty, *tags',
    meta: 'key',
    outbox: '++id, path',
    attachments: 'path, vault, filename',
  });
  return legacy;
}

describe('v5 → v6 migration', () => {
  it('strips inline image bytes but keeps the attachment metadata', async () => {
    const legacy = openV5();
    await legacy.table('attachments').put({
      path: 'r/attachments/tortilla.png',
      sha: 'imgsha1',
      vault: 'r',
      filename: 'tortilla.png',
      dataUri: 'data:image/png;base64,AAAA', // the v5 inline copy
      updatedAt: 123,
    });
    await legacy.table('notes').put({
      path: 'r/A.md',
      sha: 'n1',
      vault: 'r',
      folder: 'r',
      title: 'A',
      type: null,
      tags: [],
      active: false,
      date: null,
      snippet: '',
      frontmatter: '',
      body: 'body',
      updatedAt: 1,
    });
    legacy.close();

    // Reopening through the real schema runs the upgrade.
    const db = new VaultDb();
    const att = await db.attachments.get('r/attachments/tortilla.png');

    expect(att).toBeDefined();
    expect((att as unknown as { dataUri?: string }).dataUri).toBeUndefined();
    expect(att?.sha).toBe('imgsha1');
    expect(att?.vault).toBe('r');
    expect(att?.filename).toBe('tortilla.png');

    // Unrelated data survives, and the new table exists and is empty.
    expect((await db.notes.get('r/A.md'))?.body).toBe('body');
    expect(await db.attachmentBlobs.count()).toBe(0);
    db.close();
  });
});
