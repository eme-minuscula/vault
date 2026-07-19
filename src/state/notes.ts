import { useLiveQuery } from 'dexie-react-hooks';
import { db, type NoteRecord } from '../lib/cache/db';
import { pathMeta, type VaultId } from '../lib/vault/path';
import type { ResolvableNote } from '../lib/vault/links';

/** A single note by path (undefined while loading, null when absent). */
export function useNote(path: string | undefined): NoteRecord | null | undefined {
  return useLiveQuery(async () => {
    if (!path) return null;
    return (await db().notes.get(path)) ?? null;
  }, [path]);
}

/** All notes in one vault, sorted by folder then title. */
export function useVaultNotes(vault: VaultId | undefined): NoteRecord[] | undefined {
  return useLiveQuery(async () => {
    if (!vault) return [];
    const notes = await db().notes.where('vault').equals(vault).toArray();
    notes.sort((a, b) => a.folder.localeCompare(b.folder) || a.title.localeCompare(b.title));
    return notes;
  }, [vault]);
}

/** Every cached note (used by search). Sorted by title. */
export function useAllNotes(): NoteRecord[] | undefined {
  return useLiveQuery(async () => {
    const notes = await db().notes.toArray();
    notes.sort((a, b) => a.title.localeCompare(b.title));
    return notes;
  }, []);
}

/** All notes flagged `active: true`, across vaults, sorted by vault then title. */
export function useActiveNotes(): NoteRecord[] | undefined {
  return useLiveQuery(async () => {
    const notes = await db()
      .notes.filter((n) => n.active)
      .toArray();
    notes.sort((a, b) => a.vault.localeCompare(b.vault) || a.title.localeCompare(b.title));
    return notes;
  }, []);
}

/** Number of writes queued in the offline outbox. */
export function usePendingCount(): number {
  return useLiveQuery(() => db().outbox.count(), [], 0) ?? 0;
}

/** Per-vault note counts for the library overview. */
export function useVaultCounts(): Record<VaultId, number> | undefined {
  return useLiveQuery(async () => {
    const counts: Record<VaultId, number> = { w: 0, m: 0, r: 0, _inbox: 0, other: 0 };
    await db().notes.each((n) => {
      counts[n.vault] += 1;
    });
    return counts;
  }, []);
}

/** Map cache records to the shape wikilink resolution/backlinks expect. */
export function toResolvable(notes: readonly NoteRecord[]): (ResolvableNote & { body: string })[] {
  return notes.map((n) => ({
    path: n.path,
    vault: n.vault,
    filename: pathMeta(n.path).filename,
    body: n.body,
  }));
}
