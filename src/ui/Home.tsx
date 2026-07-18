import { useLiveQuery } from 'dexie-react-hooks';
import { db, deleteDatabase } from '../lib/cache/db';
import { useSettings } from '../state/settings';
import { useSync } from '../state/sync';
import { VAULT_LABELS, type VaultId } from '../lib/vault/path';
import { relativeTime } from './format';
import { ErrorNote } from './Onboarding';

/**
 * M1 home: proves the data layer end-to-end — shows what's cached and lets the
 * user re-sync or disconnect. Real navigation/reading replaces this in M2.
 */
export function Home() {
  const { status, error, lastResult, lastSyncAt, run } = useSync();
  const forget = useSettings((s) => s.forget);

  const counts = useLiveQuery(async () => {
    const all = await db().notes.toArray();
    const byVault = new Map<VaultId, number>();
    let active = 0;
    for (const n of all) {
      byVault.set(n.vault, (byVault.get(n.vault) ?? 0) + 1);
      if (n.active) active += 1;
    }
    return { total: all.length, active, byVault };
  }, []);

  const syncing = status === 'syncing';

  async function disconnect() {
    // Always wipe the credential first; a failed cache delete must never leave
    // the token behind. The cache is recoverable — the repo is the source of truth.
    forget();
    try {
      await deleteDatabase();
    } catch {
      /* cache delete failed; token is already cleared */
    }
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col px-6 py-10">
      <header className="flex items-baseline justify-between">
        <div>
          <p className="text-sm font-medium tracking-wide text-neutral-400 uppercase">Vault</p>
          <h1 className="mt-1 text-2xl font-semibold">Your notes</h1>
        </div>
        <button
          onClick={() => void disconnect()}
          className="text-xs text-neutral-400 underline underline-offset-2 hover:text-neutral-600 dark:hover:text-neutral-200"
        >
          Disconnect
        </button>
      </header>

      <section className="mt-8 rounded-xl border border-neutral-200 p-6 dark:border-neutral-800">
        <div className="flex items-end gap-2">
          <span className="text-4xl font-semibold tabular-nums">{counts?.total ?? '—'}</span>
          <span className="pb-1 text-neutral-500">notes cached</span>
        </div>

        {counts && counts.total > 0 && (
          <div className="mt-5 flex flex-wrap gap-2">
            {(['w', 'm', 'r', '_inbox', 'other'] as VaultId[])
              .filter((v) => (counts.byVault.get(v) ?? 0) > 0)
              .map((v) => (
                <span
                  key={v}
                  className="rounded-full bg-neutral-100 px-3 py-1 text-sm text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                >
                  {VAULT_LABELS[v]} · {counts.byVault.get(v)}
                </span>
              ))}
            <span className="rounded-full bg-amber-100 px-3 py-1 text-sm text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
              Active · {counts.active}
            </span>
          </div>
        )}
      </section>

      <div className="mt-6 flex items-center gap-4">
        <button
          onClick={() => void run()}
          disabled={syncing}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40 dark:bg-white dark:text-neutral-900"
        >
          {syncing ? 'Syncing…' : 'Sync now'}
        </button>
        <span className="text-sm text-neutral-400">
          {syncing
            ? 'Checking GitHub for changes…'
            : lastSyncAt
              ? `Synced ${relativeTime(lastSyncAt)}`
              : 'Not synced yet'}
        </span>
      </div>

      {lastResult && !syncing && status !== 'error' && (
        <p className="mt-3 text-sm text-neutral-500">
          {lastResult.upToDate
            ? 'Already up to date.'
            : `Updated ${lastResult.changed} note${lastResult.changed === 1 ? '' : 's'}` +
              (lastResult.removed ? `, removed ${lastResult.removed}.` : '.')}
        </p>
      )}

      {lastResult?.truncated && !syncing && (
        <p className="mt-2 text-sm text-amber-600 dark:text-amber-400">
          Your vault is very large and GitHub returned a partial list — some notes may be missing.
          Sync again to keep filling the cache.
        </p>
      )}

      {error && (
        <div className="mt-4">
          <ErrorNote error={error} />
        </div>
      )}

      <p className="mt-auto pt-10 text-xs text-neutral-400">
        Reading, search, and editing arrive in the next updates. This screen confirms your vault is
        syncing.
      </p>
    </div>
  );
}
