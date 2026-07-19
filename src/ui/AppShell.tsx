import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useSync } from '../state/sync';
import { usePendingCount } from '../state/notes';
import { SearchBar } from './search/SearchBar';

/** Persistent app frame: a slim top bar plus the routed content. Mobile-first. */
export function AppShell({ children }: { children: ReactNode }) {
  const syncing = useSync((s) => s.status === 'syncing');
  const pending = usePendingCount();

  return (
    <div className="min-h-full bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="sticky top-0 z-10 border-b border-neutral-200/70 bg-white/80 backdrop-blur dark:border-neutral-800/70 dark:bg-neutral-950/80">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
          <Link to="/" className="text-sm font-semibold tracking-wide">
            Vault
          </Link>
          <Link
            to="/active"
            className="text-xs text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
          >
            Active
          </Link>
          <div className="ml-auto flex items-center gap-3">
            {pending > 0 && (
              <span
                className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
                title="Writes queued offline, will sync when reconnected"
              >
                {pending} pending
              </span>
            )}
            {syncing && (
              <span className="hidden text-xs text-neutral-400 sm:inline" aria-live="polite">
                Syncing…
              </span>
            )}
            <SearchBar />
            <Link
              to="/new"
              className="rounded-lg bg-neutral-900 px-2.5 py-1.5 text-xs font-medium text-white hover:opacity-90 dark:bg-white dark:text-neutral-900"
            >
              New
            </Link>
            <Link
              to="/settings"
              className="text-xs text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
              aria-label="Settings"
            >
              Settings
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
    </div>
  );
}
