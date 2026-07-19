import type { VaultId } from '../lib/vault/path';

/** Hash-route helpers. We use hash routing so deep links survive a hard refresh
 * on GitHub Pages (no server-side SPA fallback needed). */

export function noteHref(path: string): string {
  return `#/note/${encodeSegments(path)}`;
}

export function notePathname(path: string): string {
  return `/note/${encodeSegments(path)}`;
}

export function editPathname(path: string): string {
  return `/edit/${encodeSegments(path)}`;
}

export function vaultHref(vault: VaultId): string {
  return `#/v/${vault}`;
}

/** Encode each path segment (spaces, accents, punctuation) but keep the slashes. */
export function encodeSegments(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

/** Internal hrefs produced by the wikilink transform. */
export const MISSING_HREF = '#missing';
export function isInternalNoteHref(href: string): boolean {
  return href.startsWith('#/note/');
}
