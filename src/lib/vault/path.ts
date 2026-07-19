/** Helpers for interpreting repo-relative vault paths. */

export type VaultId = 'w' | 'm' | 'r' | '_inbox' | 'other';

const KNOWN_VAULTS: readonly VaultId[] = ['w', 'm', 'r', '_inbox'];

export interface PathMeta {
  vault: VaultId;
  folder: string; // directory portion, '' at a vault root
  /** Filename without the `.md` extension. */
  filename: string;
}

export function pathMeta(path: string): PathMeta {
  const segments = path.split('/');
  const top = segments[0] ?? '';
  const vault: VaultId = (KNOWN_VAULTS as readonly string[]).includes(top)
    ? (top as VaultId)
    : 'other';
  const filename = (segments.at(-1) ?? '').replace(/\.md$/i, '');
  const folder = segments.slice(0, -1).join('/');
  return { vault, folder, filename };
}

export function isMarkdown(path: string): boolean {
  return /\.md$/i.test(path);
}

/**
 * Paths that must never be synced or displayed:
 * - anything inside a dot-folder (.stversions Syncthing backups, .obsidian,
 *   .claude, .github) — these are tooling/version-history, not notes;
 * - any `Creds.md`, which the vault marks as opaque (never read or shown).
 */
export function isExcludedPath(path: string): boolean {
  if (path.split('/').some((seg) => seg.startsWith('.'))) return true;
  if (/(^|\/)creds\.md$/i.test(path)) return true;
  return false;
}

/** Human label for a vault id, used in navigation and the vault switcher. */
export const VAULT_LABELS: Record<VaultId, string> = {
  w: 'Work',
  m: 'Personal',
  r: 'Cooking',
  _inbox: 'Inbox',
  other: 'Other',
};
