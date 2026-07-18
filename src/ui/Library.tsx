import { Link } from 'react-router-dom';
import { useVaultCounts } from '../state/notes';
import { VAULT_LABELS, type VaultId } from '../lib/vault/path';
import { vaultHref } from '../app/routes';

const ORDER: VaultId[] = ['w', 'm', 'r', '_inbox', 'other'];

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

  return (
    <div>
      <h1 className="text-2xl font-semibold">Library</h1>
      <p className="mt-1 text-sm text-neutral-500">Choose a vault to browse.</p>

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
              <div className="text-sm text-neutral-400 tabular-nums">{counts?.[v] ?? '—'}</div>
            </Link>
          ),
        )}
      </div>
    </div>
  );
}
