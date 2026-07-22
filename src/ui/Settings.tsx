import { useState } from 'react';
import { Link } from 'react-router-dom';
import { db, deleteDatabase, DB_DELETE_BLOCKED } from '../lib/cache/db';
import { useSettings } from '../state/settings';
import { useSync } from '../state/sync';
import { useTheme, type Theme } from '../state/theme';
import { usePendingCount, useVaultCounts } from '../state/notes';
import { relativeTime } from './format';
import { ErrorNote } from './Onboarding';

export function Settings() {
  const { owner, repo, branch, ignoredPrefixes, setIgnoredPrefixes, forget } = useSettings();
  const { status, error, lastResult, lastSyncAt, run } = useSync();
  const { theme, setTheme } = useTheme();
  const counts = useVaultCounts();
  const pending = usePendingCount();
  const [prefixText, setPrefixText] = useState(ignoredPrefixes.join('\n'));
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : undefined;
  const syncing = status === 'syncing';

  async function discardPending() {
    if (!window.confirm(`Discard ${pending} queued write${pending === 1 ? '' : 's'}?`)) return;
    await db().outbox.clear();
    // Those notes are now unprotected but still unconfirmed; sync immediately so
    // they're reconciled against the repo rather than lingering until it changes.
    void run();
  }

  async function disconnect() {
    setDisconnectError(null);
    forget(); // token is gone regardless of what the cache delete does
    try {
      await deleteDatabase();
    } catch (err) {
      // The only expected failure is another open Vault tab blocking the delete.
      setDisconnectError(
        err instanceof Error && err.message === DB_DELETE_BLOCKED
          ? 'Close any other open Vault tabs, then try again to finish clearing the cache.'
          : 'Could not fully clear the local cache. Your token has been removed.',
      );
    }
  }

  function savePrefixes() {
    setIgnoredPrefixes(
      prefixText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link
          to="/"
          className="text-sm text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
        >
          ← Library
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Settings</h1>
      </div>

      <section>
        <h2 className="text-sm font-medium">Appearance</h2>
        <div className="mt-2 flex rounded-lg border border-neutral-200 p-0.5 text-sm dark:border-neutral-800">
          {(['system', 'light', 'dark'] as Theme[]).map((t) => (
            <button
              key={t}
              onClick={() => setTheme(t)}
              className={
                theme === t
                  ? 'flex-1 rounded-md bg-neutral-900 px-3 py-1.5 font-medium text-white capitalize dark:bg-white dark:text-neutral-900'
                  : 'flex-1 rounded-md px-3 py-1.5 text-neutral-500 capitalize hover:text-neutral-800 dark:hover:text-neutral-200'
              }
            >
              {t}
            </button>
          ))}
        </div>
      </section>

      {pending > 0 && (
        <section>
          <h2 className="text-sm font-medium">Pending writes</h2>
          <p className="mt-1 text-sm text-neutral-500">
            {pending} change{pending === 1 ? '' : 's'} queued offline. They sync automatically when
            you reconnect. If one is stuck, you can discard it.
          </p>
          <button
            onClick={() => void discardPending()}
            className="mt-2 text-sm text-red-600 underline underline-offset-2 hover:text-red-700 dark:text-red-400"
          >
            Discard queued writes
          </button>
        </section>
      )}

      <section>
        <h2 className="text-sm font-medium">Repository</h2>
        <p className="mt-1 text-sm text-neutral-500">
          {owner}/{repo} · {branch}
        </p>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          {total ?? '—'} notes cached{lastSyncAt ? ` · synced ${relativeTime(lastSyncAt)}` : ''}
        </p>
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={() => void run()}
            disabled={syncing}
            className="rounded-lg bg-neutral-900 px-3.5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40 dark:bg-white dark:text-neutral-900"
          >
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
          <button
            onClick={() => void run({ force: true })}
            disabled={syncing}
            className="text-sm text-neutral-500 underline underline-offset-2 hover:text-neutral-800 disabled:opacity-40 dark:hover:text-neutral-200"
          >
            Full re-sync
          </button>
        </div>
        {/* A sync can succeed while a queued write failed to flush, so suppress the
            success line whenever there's an error to show instead. */}
        {lastResult && !syncing && status !== 'error' && !error && (
          <p className="mt-2 text-sm text-neutral-500">
            {lastResult.upToDate
              ? 'Already up to date.'
              : `Updated ${lastResult.changed}, removed ${lastResult.removed}.`}
          </p>
        )}
        {error && (
          <div className="mt-3">
            <ErrorNote error={error} />
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-medium">Excluded folders</h2>
        <p className="mt-1 text-sm text-neutral-500">
          Path prefixes to skip when syncing (one per line). Useful for bulky, rarely-read content.
        </p>
        <textarea
          value={prefixText}
          onChange={(e) => setPrefixText(e.target.value)}
          rows={3}
          spellCheck={false}
          className="mt-2 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 font-mono text-xs outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-100"
        />
        <button
          onClick={savePrefixes}
          className="mt-2 text-sm text-neutral-500 underline underline-offset-2 hover:text-neutral-800 dark:hover:text-neutral-200"
        >
          Save (re-sync to apply)
        </button>
      </section>

      <section>
        <h2 className="text-sm font-medium">About</h2>
        <p className="mt-1 text-sm text-neutral-500">
          Build <code className="font-mono text-xs">{__APP_BUILD__}</code> · updates apply
          automatically when you’re not editing.
        </p>
      </section>

      <section className="border-t border-neutral-200 pt-6 dark:border-neutral-800">
        <h2 className="text-sm font-medium">Disconnect</h2>
        <p className="mt-1 text-sm text-neutral-500">
          Removes your token from this device and clears the local cache.
        </p>
        <button
          onClick={() => void disconnect()}
          className="mt-3 rounded-lg border border-red-300 px-3.5 py-2 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-950/40"
        >
          Disconnect &amp; clear cache
        </button>
        {disconnectError && (
          <p className="mt-3 text-sm text-red-700 dark:text-red-300">{disconnectError}</p>
        )}
      </section>
    </div>
  );
}
