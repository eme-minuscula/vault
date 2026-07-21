import { beforeEach, describe, expect, it } from 'vitest';
import { VaultDb, type NoteRecord } from '../cache/db';
import { GitHubError } from '../github/errors';
import type { GitHubClient } from '../github/client';
import type { WriteResponse } from '../github/types';
import { deleteNote, flushOutbox, saveNoteText, setNoteActive } from './mutations';

class FakeClient {
  putCalls: { path: string; text: string; sha?: string }[] = [];
  deleteCalls: { path: string; sha: string }[] = [];
  nextError: GitHubError | null = null;
  shaCounter = 100;

  putFile(
    path: string,
    a: { message: string; text: string; sha?: string },
  ): Promise<WriteResponse> {
    if (this.nextError) return Promise.reject(this.nextError);
    this.putCalls.push({ path, text: a.text, sha: a.sha });
    return Promise.resolve({
      content: { sha: `sha${this.shaCounter++}`, path },
      commit: { sha: 'c' },
    });
  }
  deleteFile(path: string, a: { message: string; sha: string }): Promise<WriteResponse> {
    if (this.nextError) return Promise.reject(this.nextError);
    this.deleteCalls.push({ path, sha: a.sha });
    return Promise.resolve({ content: null, commit: { sha: 'c' } });
  }
}

const asClient = (f: FakeClient) => f as unknown as GitHubClient;
const net = () => new GitHubError('network', 'offline');

let db: VaultDb;
beforeEach(async () => {
  db = new VaultDb();
  await db.clearAll();
});

async function seed(path: string, raw: string, sha = 'old'): Promise<NoteRecord> {
  const { toRecord } = await import('../sync/sync');
  const rec = toRecord(path, sha, raw);
  await db.notes.put(rec);
  return rec;
}

describe('saveNoteText', () => {
  it('creates without a sha and stores the returned sha', async () => {
    const fake = new FakeClient();
    const res = await saveNoteText(asClient(fake), db, 'w/New.md', '# New\n\nbody', {
      create: true,
    });
    expect(res.queued).toBe(false);
    expect(fake.putCalls[0]?.sha).toBeUndefined();
    expect((await db.notes.get('w/New.md'))?.sha).toBe('sha100');
  });

  it('updates with the existing base sha', async () => {
    await seed('w/A.md', '---\ntype: note\n---\nold', 'blob1');
    await saveNoteText(asClient(new FakeClient()), db, 'w/A.md', '---\ntype: note\n---\nnew');
    const note = await db.notes.get('w/A.md');
    expect(note?.body).toBe('new');
  });

  it('queues offline and keeps the optimistic cache', async () => {
    const fake = new FakeClient();
    fake.nextError = net();
    const res = await saveNoteText(asClient(fake), db, 'w/A.md', 'hello', { create: true });
    expect(res.queued).toBe(true);
    expect(await db.outbox.count()).toBe(1);
    expect((await db.notes.get('w/A.md'))?.body).toBe('hello');
  });

  it('marks a confirmed write clean, and an unconfirmed response dirty', async () => {
    const fake = new FakeClient();
    await saveNoteText(asClient(fake), db, 'w/Ok.md', 'body', { create: true });
    expect((await db.notes.get('w/Ok.md'))?.dirty).toBeUndefined();

    // A response without content.sha is not confirmation — stay repairable.
    const noSha = new FakeClient();
    noSha.putFile = () => Promise.resolve({ content: null, commit: { sha: 'c' } });
    await saveNoteText(asClient(noSha), db, 'w/Unconfirmed.md', 'body', { create: true });
    expect((await db.notes.get('w/Unconfirmed.md'))?.dirty).toBe(1);
  });

  it('rolls back the optimistic write on a hard error', async () => {
    await seed('w/A.md', 'original', 'blob1');
    const fake = new FakeClient();
    fake.nextError = new GitHubError('conflict', 'stale', 409);
    await expect(saveNoteText(asClient(fake), db, 'w/A.md', 'changed')).rejects.toMatchObject({
      kind: 'conflict',
    });
    expect((await db.notes.get('w/A.md'))?.body).toBe('original');
  });
});

describe('deleteNote', () => {
  it('removes the note and calls delete with its sha', async () => {
    await seed('w/A.md', 'body', 'blob9');
    const fake = new FakeClient();
    await deleteNote(asClient(fake), db, 'w/A.md');
    expect(fake.deleteCalls[0]?.sha).toBe('blob9');
    expect(await db.notes.get('w/A.md')).toBeUndefined();
  });

  it('cancels the queued create when a note is created then deleted offline', async () => {
    const off = new FakeClient();
    off.nextError = net();
    await saveNoteText(asClient(off), db, 'w/Tmp.md', 'draft', { create: true });
    expect(await db.outbox.count()).toBe(1);

    const res = await deleteNote(asClient(new FakeClient()), db, 'w/Tmp.md');
    expect(res.queued).toBe(false);
    expect(await db.outbox.count()).toBe(0); // no delete queued against a non-existent file
    expect(await db.notes.get('w/Tmp.md')).toBeUndefined();
  });

  it('queues a delete offline', async () => {
    await seed('w/A.md', 'body', 'blob9');
    const fake = new FakeClient();
    fake.nextError = net();
    const res = await deleteNote(asClient(fake), db, 'w/A.md');
    expect(res.queued).toBe(true);
    expect(await db.notes.get('w/A.md')).toBeUndefined(); // optimistic removal
    expect(await db.outbox.count()).toBe(1);
  });
});

describe('setNoteActive', () => {
  it('writes an activated version of the note', async () => {
    const rec = await seed('m/D.md', '---\ntype: daily\n---\nbody', 'blob1');
    const fake = new FakeClient();
    await setNoteActive(asClient(fake), db, rec, true);
    expect(fake.putCalls[0]?.text).toBe('---\nactive: true\ntype: daily\n---\nbody');
    expect((await db.notes.get('m/D.md'))?.active).toBe(true);
  });

  it('is a no-op when the flag is already in the desired state', async () => {
    const rec = await seed('m/D.md', '---\nactive: true\n---\nbody', 'blob1');
    const fake = new FakeClient();
    const res = await setNoteActive(asClient(fake), db, rec, true);
    expect(res.queued).toBe(false);
    expect(fake.putCalls).toHaveLength(0);
  });
});

describe('flushOutbox', () => {
  it('flushes queued writes when back online', async () => {
    const offline = new FakeClient();
    offline.nextError = net();
    await saveNoteText(asClient(offline), db, 'w/A.md', 'queued body', { create: true });
    expect(await db.outbox.count()).toBe(1);

    const online = new FakeClient();
    const result = await flushOutbox(asClient(online), db);
    expect(result.flushed).toBe(1);
    expect(result.remaining).toBe(0);
    expect(online.putCalls[0]?.text).toBe('queued body');
    expect((await db.notes.get('w/A.md'))?.sha).toBe('sha100');
  });

  it('stops and reports a hard error, leaving the op queued', async () => {
    const offline = new FakeClient();
    offline.nextError = net();
    await saveNoteText(asClient(offline), db, 'w/A.md', 'body', { create: true });

    const online = new FakeClient();
    online.nextError = new GitHubError('conflict', 'stale', 409);
    const result = await flushOutbox(asClient(online), db);
    expect(result.flushed).toBe(0);
    expect(result.remaining).toBe(1);
    expect(result.error?.kind).toBe('conflict');
  });
});
