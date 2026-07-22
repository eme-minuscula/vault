import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type NoteRecord } from '../lib/cache/db';
import type { VaultId } from '../lib/vault/path';
import type { ResolvableAttachment } from '../lib/vault/attachments';
import { ensureAttachmentDataUri } from '../lib/vault/attachmentLoader';
import { currentClient } from './client';

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

/**
 * Number of writes queued in the offline outbox.
 *
 * `enabled` guards the `db()` call: when false we never touch IndexedDB, so a
 * component mounted before connecting (or after "Disconnect & clear cache")
 * can't recreate the database that was just deleted.
 */
export function usePendingCount(enabled = true): number {
  return useLiveQuery(() => (enabled ? db().outbox.count() : 0), [enabled], 0) ?? 0;
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

/** Image attachments in one vault (for resolving embeds). */
export function useVaultAttachments(
  vault: VaultId | undefined,
): ResolvableAttachment[] | undefined {
  return useLiveQuery(async () => {
    if (!vault) return [];
    return db().attachments.where('vault').equals(vault).toArray();
  }, [vault]);
}

export interface AttachmentState {
  dataUri?: string;
  loading: boolean;
  error: boolean;
}

/**
 * Resolve an attachment path to a rendered data URI, loading it on first use.
 *
 * Metadata and bytes are separate live queries: the metadata row is small, and
 * the blob is fetched by content SHA so duplicate images share one cache entry.
 */
export function useAttachment(path: string | undefined): AttachmentState {
  const row = useLiveQuery(
    async () => (path ? ((await db().attachments.get(path)) ?? null) : null),
    [path],
  );
  const blob = useLiveQuery(
    async () => (row?.sha ? ((await db().attachmentBlobs.get(row.sha)) ?? null) : null),
    [row?.sha],
  );
  const [error, setError] = useState(false);
  // SHAs this component has already loaded once. Prevents an endless fetch loop
  // if a blob disappears again afterwards (e.g. evicted under cache pressure):
  // without it, the blob query firing null would re-enter this effect forever.
  // Marked when a load *settles*, not when it starts — otherwise React's
  // StrictMode double-invoke would flag the second run as a repeat while the
  // first fetch is still in flight.
  const attempted = useRef(new Set<string>());

  useEffect(() => {
    if (!row || blob) return;
    const client = currentClient();
    if (!client || attempted.current.has(row.sha)) {
      setError(true);
      return;
    }
    setError(false);
    const sha = row.sha;
    let cancelled = false;
    ensureAttachmentDataUri(client, db(), row)
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        attempted.current.add(sha);
      });
    return () => {
      cancelled = true;
    };
  }, [row, blob]);

  // Only pair bytes with the metadata they belong to: useLiveQuery keeps its
  // previous result while re-running, so the two can briefly disagree and show
  // the wrong image for a frame.
  const paired = blob && row && blob.sha === row.sha ? blob : undefined;

  return {
    dataUri: paired?.dataUri,
    loading: !!row && !paired && !error,
    error: error || (path !== undefined && row === null),
  };
}
