import { create } from 'zustand';
import { GitHubClient } from '../lib/github/client';
import { GitHubError, type GitHubErrorKind } from '../lib/github/errors';
import { db } from '../lib/cache/db';
import { syncVault, type SyncProgress, type SyncResult } from '../lib/sync/sync';
import { flushOutbox } from '../lib/vault/mutations';
import { useSettings } from './settings';

export interface SyncError {
  kind: GitHubErrorKind | 'config';
  message: string;
  rateLimitReset: number | null;
}

interface SyncState {
  status: 'idle' | 'syncing' | 'error';
  progress: SyncProgress | null;
  error: SyncError | null;
  lastResult: SyncResult | null;
  lastSyncAt: number | null;
  run: (opts?: { force?: boolean }) => Promise<void>;
}

export const useSync = create<SyncState>((set, get) => ({
  status: 'idle',
  progress: null,
  error: null,
  lastResult: null,
  lastSyncAt: null,

  run: async (opts = {}) => {
    if (get().status === 'syncing') return;

    const { token, owner, repo, branch, ignoredPrefixes, setConfigured } = useSettings.getState();
    if (!token) {
      set({
        status: 'error',
        error: { kind: 'config', message: 'Add a GitHub token to connect.', rateLimitReset: null },
      });
      return;
    }

    set({
      status: 'syncing',
      error: null,
      progress: { phase: 'checking', fetched: 0, toFetch: 0 },
    });

    try {
      const client = new GitHubClient({ token, owner, repo, branch });
      // Push queued writes BEFORE reconciling, so the sync's prune/refetch never
      // fights a local write that hasn't reached GitHub yet. Anything that fails
      // to flush stays in the outbox and is shielded from the reconcile pass.
      await flushOutbox(client, db());
      const stillPending = new Set((await db().outbox.toArray()).map((o) => o.path));
      const result = await syncVault(client, db(), {
        ignoredPrefixes,
        force: opts.force,
        protectedPaths: stillPending,
        onProgress: (progress) => set({ progress }),
      });
      setConfigured(true);
      set({
        status: 'idle',
        progress: null,
        lastResult: result,
        lastSyncAt: Date.now(),
        error: null,
      });
    } catch (err) {
      set({ status: 'error', progress: null, error: toSyncError(err) });
    }
  },
}));

function toSyncError(err: unknown): SyncError {
  if (err instanceof GitHubError) {
    return { kind: err.kind, message: err.message, rateLimitReset: err.rateLimitReset };
  }
  return {
    kind: 'unknown',
    message: err instanceof Error ? err.message : 'Sync failed',
    rateLimitReset: null,
  };
}
