import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { VaultDb } from './db';

/**
 * The v6 and v7 upgrades rewrite data an existing user already has on disk, so
 * they get their own tests: everything else in the suite starts from a fresh
 * database.
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

/** The v6 schema, as shipped before `aliases` was added to notes. */
function openV6(): Dexie {
  const legacy = new Dexie(NAME);
  legacy.version(6).stores({
    notes: 'path, vault, type, date, dirty, *tags',
    meta: 'key',
    outbox: '++id, path',
    attachments: 'path, vault, filename',
    attachmentBlobs: 'sha, usedAt, [usedAt+size]',
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

describe('v6 → v7 migration', () => {
  it('backfills aliases by re-parsing the stored frontmatter', async () => {
    const legacy = openV6();
    // A note cached before `aliases` existed: no such field, but its verbatim
    // fenced frontmatter block is on disk.
    await legacy.table('notes').put({
      path: 'w/People/wk.md',
      sha: 'n1',
      vault: 'w',
      folder: 'w/People',
      title: 'Wes Kao',
      type: 'person',
      tags: [],
      active: false,
      date: null,
      snippet: '',
      frontmatter: '---\naliases: [WK, Wes]\ntype: person\n---\n',
      body: '# Wes Kao\n',
      updatedAt: 1,
    });
    // A frontmatter-less note backfills to an empty list, not a crash.
    await legacy.table('notes').put({
      path: 'w/Plain.md',
      sha: 'n2',
      vault: 'w',
      folder: 'w',
      title: 'Plain',
      type: null,
      tags: [],
      active: false,
      date: null,
      snippet: '',
      frontmatter: '',
      body: 'plain',
      updatedAt: 1,
    });
    legacy.close();

    // Reopening through the real schema runs the v7 upgrade.
    const db = new VaultDb();
    expect((await db.notes.get('w/People/wk.md'))?.aliases).toEqual(['WK', 'Wes']);
    expect((await db.notes.get('w/Plain.md'))?.aliases).toEqual([]);
    db.close();
  });
});
