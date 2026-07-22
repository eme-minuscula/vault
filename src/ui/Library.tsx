import { Link } from 'react-router-dom';
import { useActiveNotes, useVaultCounts } from '../state/notes';
import { VAULT_LABELS, type VaultId } from '../lib/vault/path';
import { vaultHref } from '../app/routes';

// Inbox is intentionally not a Library card: `_inbox` captures are flagged
// active, so they surface in the Active view (and search) — a separate Inbox
// section would just duplicate that.
const ORDER: VaultId[] = ['w', 'm', 'r', 'other'];

const DESCRIPTIONS: Record<VaultId, string> = {
  w: 'Work, projects, people, learning',
  m: 'Journal, daily notes, books, travel',
  r: 'Recipes, menus, cooking notes',
  _inbox: 'Unfiled quick captures',
  other: 'Everything else',
};

/** Landing page: the three vaults (plus inbox/other) with live counts. */
export function Library() {
  const counts = useVaultCounts();
  const active = useActiveNotes();
  const activeCount = active?.length ?? 0;

  return (
    <div>
      <h1 className="text-2xl font-semibold">Library</h1>
      <p className="mt-1 text-sm text-neutral-500">Choose a vault to browse.</p>

      {activeCount > 0 && (
        <Link
          to="/active"
          className="mt-6 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 p-4 no-underline transition-colors hover:bg-amber-100 dark:border-amber-900/50 dark:bg-amber-950/30 dark:hover:bg-amber-950/50"
        >
          <div>
            <div className="font-medium text-amber-900 dark:text-amber-200">Active</div>
            <div className="mt-0.5 text-sm text-amber-700/80 dark:text-amber-300/70">
              In-flight notes across all vaults
            </div>
          </div>
          <div className="text-sm text-amber-700 tabular-nums dark:text-amber-300">
            {activeCount}
          </div>
        </Link>
      )}

      <div className="mt-6 grid gap-3">
        {ORDER.filter((v) => (counts?.[v] ?? 0) > 0 || v === 'w' || v === 'm' || v === 'r').map(
          (v) => (
            <Link
              key={v}
              to={vaultHref(v).slice(1)}
              className="group flex items-center justify-between rounded-xl border border-neutral-200 p-4 transition-colors hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:border-neutral-700 dark:hover:bg-neutral-900"
            >
              <div>
                <div className="font-medium">{VAULT_LABELS[v]}</div>
                <div className="mt-0.5 text-sm text-neutral-500">{DESCRIPTIONS[v]}</div>
              </div>
              <div className="text-sm text-neutral-500 tabular-nums dark:text-neutral-400">
                {counts?.[v] ?? '—'}
              </div>
            </Link>
          ),
        )}
      </div>
    </div>
  );
}
