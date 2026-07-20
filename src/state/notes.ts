import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type AttachmentRecord, type NoteRecord } from '../lib/cache/db';
import { pathMeta, type VaultId } from '../lib/vault/path';
import { mimeFor, type ResolvableAttachment } from '../lib/vault/attachments';
import type { ResolvableNote } from '../lib/vault/links';
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

/** Image attachments in one vault (for resolving embeds). */
export function useVaultAttachments(
  vault: VaultId | undefined,
): ResolvableAttachment[] | undefined {
  return useLiveQuery(async () => {
    if (!vault) return [];
    return db().attachments.where('vault').equals(vault).toArray();
  }, [vault]);
}

// In-flight loads keyed by blob sha, so the same image isn't fetched twice.
const inFlight = new Map<string, Promise<string>>();

/** Fetch + cache an attachment's bytes as a data URI (idempotent). */
export async function ensureAttachmentDataUri(row: AttachmentRecord): Promise<string> {
  if (row.dataUri) return row.dataUri;
  const cached = await db().attachments.get(row.path);
  if (cached?.dataUri) return cached.dataUri;

  const existing = inFlight.get(row.sha);
  if (existing) return existing;

  const load = (async () => {
    const client = currentClient();
    if (!client) throw new Error('Not connected');
    const base64 = await client.getBlobBase64(row.sha);
    const dataUri = `data:${mimeFor(row.filename)};base64,${base64}`;
    // Git blob SHAs are content-addressed, so identical images at different paths
    // share a SHA — write the loaded URI to every row with this SHA, not just one,
    // so a duplicate embed doesn't get stuck on the loading placeholder.
    await db()
      .attachments.filter((a) => a.sha === row.sha)
      .modify({ dataUri });
    return dataUri;
  })();
  inFlight.set(row.sha, load);
  try {
    return await load;
  } finally {
    inFlight.delete(row.sha);
  }
}

export interface AttachmentState {
  dataUri?: string;
  loading: boolean;
  error: boolean;
}

/** Resolve an attachment path to a rendered data URI, loading it on first use. */
export function useAttachment(path: string | undefined): AttachmentState {
  const row = useLiveQuery(
    async () => (path ? ((await db().attachments.get(path)) ?? null) : null),
    [path],
  );
  const [error, setError] = useState(false);

  useEffect(() => {
    setError(false);
    if (!row || row.dataUri) return;
    let cancelled = false;
    ensureAttachmentDataUri(row).catch(() => {
      if (!cancelled) setError(true);
    });
    return () => {
      cancelled = true;
    };
  }, [row]);

  return {
    dataUri: row?.dataUri,
    loading: !!row && !row.dataUri && !error,
    error: error || (path !== undefined && row === null),
  };
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
