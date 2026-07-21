import { beforeEach, describe, expect, it } from 'vitest';
import { VaultDb } from '../cache/db';
import type { GitHubClient } from '../github/client';
import type { Conditional } from '../github/types';
import type { BranchResponse } from '../github/types';
import { syncVault, toRecord } from './sync';

/** A scriptable stand-in for GitHubClient covering only what syncVault calls. */
class FakeClient {
  branchQueue: Conditional<BranchResponse>[] = [];
  treeEntries: { path: string; type: 'blob' | 'tree'; sha: string }[] = [];
  truncated = false;
  blobs = new Map<string, string>();
  blobFetches: string[] = [];

  getBranch(): Promise<Conditional<BranchResponse>> {
    const next = this.branchQueue.shift();
    if (!next) throw new Error('no branch response queued');
    return Promise.resolve(next);
  }
  getTree() {
    return Promise.resolve({ sha: 'tree', truncated: this.truncated, tree: this.treeEntries });
  }
  getBlobText(sha: string): Promise<string> {
    this.blobFetches.push(sha);
    return Promise.resolve(this.blobs.get(sha) ?? '');
  }
}

function branch(sha: string, treeSha: string, etag: string): Conditional<BranchResponse> {
  return {
    notModified: false,
    etag,
    data: { commit: { sha, commit: { tree: { sha: treeSha } } } },
  };
}

const asClient = (f: FakeClient) => f as unknown as GitHubClient;

let database: VaultDb;

beforeEach(async () => {
  database = new VaultDb();
  await database.clearAll();
});

describe('syncVault', () => {
  it('fetches markdown blobs, skips ignored prefixes and non-markdown', async () => {
    const fake = new FakeClient();
    fake.branchQueue = [branch('c1', 't1', 'W/"e1"')];
    fake.treeEntries = [
      { path: 'w/Note.md', type: 'blob', sha: 'b1' },
      { path: 'm/Journal.md', type: 'blob', sha: 'b2' },
      { path: 'w/PrOps/Knowledge/LennysPodcast/ep.md', type: 'blob', sha: 'b3' },
      { path: 'r/attachments/pic.png', type: 'blob', sha: 'b4' },
      { path: '.stversions/w/Old.md', type: 'blob', sha: 'b5' }, // dot-folder → excluded
      { path: 'w/Projects/HA/Creds.md', type: 'blob', sha: 'b6' }, // Creds → excluded
      { path: 'w', type: 'tree', sha: 'tdir' },
    ];
    fake.blobs.set('b1', '---\ntype: learning\nactive: true\n---\n# Work note\nbody');
    fake.blobs.set('b2', '---\ntype: journal\n---\nDear diary');

    const result = await syncVault(asClient(fake), database, {
      ignoredPrefixes: ['w/PrOps/Knowledge/LennysPodcast/'],
    });

    expect(result.changed).toBe(2);
    expect(result.upToDate).toBe(false);
    expect(fake.blobFetches.sort()).toEqual(['b1', 'b2']);

    const notes = await database.notes.toArray();
    expect(notes.map((n) => n.path).sort()).toEqual(['m/Journal.md', 'w/Note.md']);
    const work = await database.notes.get('w/Note.md');
    expect(work?.title).toBe('Work note');
    expect(work?.active).toBe(true);
    expect(work?.vault).toBe('w');
  });

  it('records the head sha and branch etag for cheap re-checks', async () => {
    const fake = new FakeClient();
    fake.branchQueue = [branch('c1', 't1', 'W/"e1"')];
    fake.treeEntries = [{ path: 'w/A.md', type: 'blob', sha: 'b1' }];
    fake.blobs.set('b1', 'hi');
    await syncVault(asClient(fake), database, {});
    expect(await database.getMeta('headSha')).toBe('c1');
    expect(await database.getMeta('branchEtag')).toBe('W/"e1"');
  });

  it('short-circuits when the branch is unchanged (304)', async () => {
    const fake = new FakeClient();
    fake.branchQueue = [{ notModified: true, etag: 'W/"e1"', data: null }];
    const result = await syncVault(asClient(fake), database, {});
    expect(result.upToDate).toBe(true);
    expect(result.changed).toBe(0);
    expect(fake.blobFetches).toEqual([]);
  });

  it('on delta only refetches changed blobs and prunes removed notes', async () => {
    // First sync: two notes.
    const first = new FakeClient();
    first.branchQueue = [branch('c1', 't1', 'W/"e1"')];
    first.treeEntries = [
      { path: 'w/A.md', type: 'blob', sha: 'a1' },
      { path: 'w/B.md', type: 'blob', sha: 'b1' },
    ];
    first.blobs.set('a1', 'A one');
    first.blobs.set('b1', 'B one');
    await syncVault(asClient(first), database, {});

    // Second sync: A changed (a1 -> a2), B deleted, C added.
    const second = new FakeClient();
    second.branchQueue = [branch('c2', 't2', 'W/"e2"')];
    second.treeEntries = [
      { path: 'w/A.md', type: 'blob', sha: 'a2' },
      { path: 'w/C.md', type: 'blob', sha: 'c1' },
    ];
    second.blobs.set('a2', 'A two');
    second.blobs.set('c1', 'C one');
    const result = await syncVault(asClient(second), database, {});

    expect(second.blobFetches.sort()).toEqual(['a2', 'c1']); // not B (unchanged path gone)
    expect(result.changed).toBe(2);
    expect(result.removed).toBe(1);

    const paths = (await database.notes.toArray()).map((n) => n.path).sort();
    expect(paths).toEqual(['w/A.md', 'w/C.md']);
    expect((await database.notes.get('w/A.md'))?.body).toBe('A two');
  });

  it('on a truncated tree, does not prune and does not persist the watermark', async () => {
    // Seed one cached note via a normal sync.
    const first = new FakeClient();
    first.branchQueue = [branch('c1', 't1', 'W/"e1"')];
    first.treeEntries = [{ path: 'w/A.md', type: 'blob', sha: 'a1' }];
    first.blobs.set('a1', 'A one');
    await syncVault(asClient(first), database, {});

    // Truncated sync that omits w/A.md and adds w/B.md.
    const second = new FakeClient();
    second.truncated = true;
    second.branchQueue = [branch('c2', 't2', 'W/"e2"')];
    second.treeEntries = [{ path: 'w/B.md', type: 'blob', sha: 'b1' }];
    second.blobs.set('b1', 'B one');
    const result = await syncVault(asClient(second), database, {});

    expect(result.truncated).toBe(true);
    expect(result.removed).toBe(0); // A.md must NOT be pruned despite being absent
    const paths = (await database.notes.toArray()).map((n) => n.path).sort();
    expect(paths).toEqual(['w/A.md', 'w/B.md']);
    // Watermark stays at the first sync so the next sync retries in full.
    expect(await database.getMeta('headSha')).toBe('c1');
    expect(await database.getMeta('branchEtag')).toBe('W/"e1"');
  });

  it('shields protected paths from prune and refetch', async () => {
    // First sync seeds A and B.
    const first = new FakeClient();
    first.branchQueue = [branch('c1', 't1', 'W/"e1"')];
    first.treeEntries = [
      { path: 'w/A.md', type: 'blob', sha: 'a1' },
      { path: 'w/B.md', type: 'blob', sha: 'b1' },
    ];
    first.blobs.set('a1', 'A one');
    first.blobs.set('b1', 'B one');
    await syncVault(asClient(first), database, {});

    // Second sync: A is gone from the tree (would prune) and B changed (would
    // refetch) — but both are protected, so neither happens.
    const second = new FakeClient();
    second.branchQueue = [branch('c2', 't2', 'W/"e2"')];
    second.treeEntries = [{ path: 'w/B.md', type: 'blob', sha: 'b2' }];
    second.blobs.set('b2', 'B two');
    const result = await syncVault(asClient(second), database, {
      protectedPaths: new Set(['w/A.md', 'w/B.md']),
    });

    expect(second.blobFetches).toEqual([]); // B not refetched
    expect(result.removed).toBe(0); // A not pruned
    const paths = (await database.notes.toArray()).map((n) => n.path).sort();
    expect(paths).toEqual(['w/A.md', 'w/B.md']);
    expect((await database.notes.get('w/B.md'))?.body).toBe('B one'); // local copy kept
  });

  it('re-fetches a note whose local edit was never confirmed, repairing divergence', async () => {
    // Seed a synced note.
    const first = new FakeClient();
    first.branchQueue = [branch('c1', 't1', 'W/"e1"')];
    first.treeEntries = [{ path: 'w/A.md', type: 'blob', sha: 'a1' }];
    first.blobs.set('a1', 'from the repo');
    await syncVault(asClient(first), database, {});

    // Exactly the state a lost write leaves behind: edited body, still tagged with
    // the pre-edit SHA, never confirmed (process died between put and confirm).
    await database.notes.put(toRecord('w/A.md', 'a1', 'unsaved local edit', { dirty: true }));

    // The repo is unchanged, so a plain SHA comparison would skip this note forever.
    const second = new FakeClient();
    second.branchQueue = [branch('c2', 't2', 'W/"e2"')];
    second.treeEntries = [{ path: 'w/A.md', type: 'blob', sha: 'a1' }];
    second.blobs.set('a1', 'from the repo');
    await syncVault(asClient(second), database, {});

    expect(second.blobFetches).toEqual(['a1']); // repaired, not skipped
    const note = await database.notes.get('w/A.md');
    expect(note?.body).toBe('from the repo');
    expect(note?.dirty).toBeFalsy();
  });

  it('leaves a confirmed, unchanged note alone (no blanket refetch)', async () => {
    const first = new FakeClient();
    first.branchQueue = [branch('c1', 't1', 'W/"e1"')];
    first.treeEntries = [{ path: 'w/A.md', type: 'blob', sha: 'a1' }];
    first.blobs.set('a1', 'body');
    await syncVault(asClient(first), database, {});

    const second = new FakeClient();
    second.branchQueue = [branch('c2', 't2', 'W/"e2"')];
    second.treeEntries = [{ path: 'w/A.md', type: 'blob', sha: 'a1' }];
    await syncVault(asClient(second), database, {});

    expect(second.blobFetches).toEqual([]);
  });

  it('does not re-fetch a dirty note that still has a queued write', async () => {
    const first = new FakeClient();
    first.branchQueue = [branch('c1', 't1', 'W/"e1"')];
    first.treeEntries = [{ path: 'w/A.md', type: 'blob', sha: 'a1' }];
    first.blobs.set('a1', 'from the repo');
    await syncVault(asClient(first), database, {});
    await database.notes.put(toRecord('w/A.md', 'a1', 'queued offline edit', { dirty: true }));

    const second = new FakeClient();
    second.branchQueue = [branch('c2', 't2', 'W/"e2"')];
    second.treeEntries = [{ path: 'w/A.md', type: 'blob', sha: 'a1' }];
    second.blobs.set('a1', 'from the repo');
    await syncVault(asClient(second), database, {
      protectedPaths: new Set(['w/A.md']),
    });

    expect(second.blobFetches).toEqual([]);
    expect((await database.notes.get('w/A.md'))?.body).toBe('queued offline edit');
  });

  it('purges an already-cached excluded note even on a 304', async () => {
    await database.notes.put(toRecord('w/Projects/HA/Creds.md', 'x', 'secret'));
    expect(await database.notes.get('w/Projects/HA/Creds.md')).toBeDefined();

    const fake = new FakeClient();
    fake.branchQueue = [{ notModified: true, etag: 'W/"e1"', data: null }];
    await syncVault(asClient(fake), database, {});

    expect(await database.notes.get('w/Projects/HA/Creds.md')).toBeUndefined();
    expect(await database.getMeta('excludedCleanup:v1')).toBe('1');
  });

  it('reports progress phases', async () => {
    const fake = new FakeClient();
    fake.branchQueue = [branch('c1', 't1', 'W/"e1"')];
    fake.treeEntries = [{ path: 'w/A.md', type: 'blob', sha: 'b1' }];
    fake.blobs.set('b1', 'hi');
    const phases: string[] = [];
    await syncVault(asClient(fake), database, { onProgress: (p) => phases.push(p.phase) });
    expect(phases).toContain('fetching');
    expect(phases.at(-1)).toBe('done');
  });
});
