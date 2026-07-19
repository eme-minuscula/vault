import Dexie, { type EntityTable } from 'dexie';
import type { VaultId } from '../vault/path';

/** One cached note. `path` is the repo-relative path and the primary key. */
export interface NoteRecord {
  path: string;
  /** Immutable git blob SHA — lets us skip re-fetching unchanged files. */
  sha: string;
  vault: VaultId; // top-level segment
  folder: string; // directory portion, '' for repo root
  title: string; // display title (H1 if present, else filename)
  type: string | null;
  tags: string[];
  active: boolean;
  date: string | null;
  snippet: string;
  /** Verbatim frontmatter block (fences included), or '' — needed to write losslessly. */
  frontmatter: string;
  body: string;
  updatedAt: number; // local cache timestamp (ms)
}

/** A queued write, held while offline and flushed when back online. */
export interface OutboxOp {
  id?: number;
  op: 'put' | 'delete';
  path: string;
  message: string;
  /** Full file text for a `put`. */
  text?: string;
  /** Blob SHA the edit was based on; undefined for a create. */
  baseSha?: string;
  createdAt: number;
}

/** Reassemble the full note text (frontmatter + body) for writing back. */
export function fullText(note: Pick<NoteRecord, 'frontmatter' | 'body'>): string {
  return (note.frontmatter ?? '') + note.body;
}

/** Small key/value store for sync bookkeeping (HEAD sha, branch ETag, …). */
export interface MetaRecord {
  key: string;
  value: string;
}

const DB_NAME = 'vault-cache';

export class VaultDb extends Dexie {
  notes!: EntityTable<NoteRecord, 'path'>;
  meta!: EntityTable<MetaRecord, 'key'>;
  outbox!: EntityTable<OutboxOp, 'id'>;

  constructor() {
    super(DB_NAME);
    this.version(1).stores({
      notes: 'path, vault, type, active, date, *tags',
      meta: 'key',
    });
    // v2 drops the `active` index: IndexedDB can't index booleans, so it was a
    // dead (misleading) index. The Active view filters in memory instead.
    this.version(2).stores({
      notes: 'path, vault, type, date, *tags',
      meta: 'key',
    });
    // v3 adds the offline write outbox.
    this.version(3).stores({
      notes: 'path, vault, type, date, *tags',
      meta: 'key',
      outbox: '++id, path',
    });
  }

  async getMeta(key: string): Promise<string | null> {
    const row = await this.meta.get(key);
    return row?.value ?? null;
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.meta.put({ key, value });
  }

  /** Wipe all cached content (e.g. on sign-out or repo switch). */
  async clearAll(): Promise<void> {
    await this.transaction('rw', this.notes, this.meta, this.outbox, async () => {
      await this.notes.clear();
      await this.meta.clear();
      await this.outbox.clear();
    });
  }
}

/** Singleton, created lazily so tests can substitute their own instance. */
let instance: VaultDb | null = null;
export function db(): VaultDb {
  instance ??= new VaultDb();
  return instance;
}

/** Delete the entire IndexedDB database from disk. */
export async function deleteDatabase(): Promise<void> {
  if (instance) {
    instance.close();
    instance = null;
  }
  await Dexie.delete(DB_NAME);
}
