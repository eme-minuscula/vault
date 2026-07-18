import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useSync } from '../state/sync';

/** Persistent app frame: a slim top bar plus the routed content. Mobile-first. */
export function AppShell({ children }: { children: ReactNode }) {
  const syncing = useSync((s) => s.status === 'syncing');

  return (
    <div className="min-h-full bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="sticky top-0 z-10 border-b border-neutral-200/70 bg-white/80 backdrop-blur dark:border-neutral-800/70 dark:bg-neutral-950/80">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link to="/" className="text-sm font-semibold tracking-wide">
            Vault
          </Link>
          <div className="flex items-center gap-3">
            {syncing && (
              <span className="text-xs text-neutral-400" aria-live="polite">
                Syncing…
              </span>
            )}
            <Link
              to="/settings"
              className="text-xs text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
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
