import type { VaultId } from './path';

/**
 * Obsidian-style `[[wikilink]]` handling.
 *
 * Targets may look like `Name`, `Name|Label`, `Name#Heading`, `folder/Name`, or
 * an embed `![[Name]]`. Resolution stays *within a single vault* — the vault's
 * isolation is load-bearing, so a link in `w/` never resolves into `m/` or `r/`.
 */

export interface WikiLink {
  /** The link target with any `#heading`/`^block` and `|label` stripped. */
  target: string;
  heading: string | null;
  label: string | null;
  embed: boolean;
  raw: string;
}

// Non-greedy inner match; wikilinks don't span newlines.
const WIKILINK_RE = /(!?)\[\[([^\]\n]+?)\]\]/g;

export function parseWikiTarget(inner: string, embed = false, raw = ''): WikiLink {
  let rest = inner;
  let label: string | null = null;
  const pipe = rest.indexOf('|');
  if (pipe !== -1) {
    label = rest.slice(pipe + 1).trim() || null;
    rest = rest.slice(0, pipe);
  }
  let heading: string | null = null;
  const hash = rest.search(/[#^]/);
  if (hash !== -1) {
    heading = rest.slice(hash + 1).trim() || null;
    rest = rest.slice(0, hash);
  }
  return { target: rest.trim(), heading, label, embed, raw };
}

/** All wikilinks in a body, in document order (embeds included). */
export function extractWikiLinks(body: string): WikiLink[] {
  const out: WikiLink[] = [];
  for (const m of body.matchAll(WIKILINK_RE)) {
    out.push(parseWikiTarget(m[2] ?? '', m[1] === '!', m[0]));
  }
  return out;
}

export interface ResolvableNote {
  path: string;
  vault: VaultId;
  filename: string;
}

/**
 * Resolve a wikilink target to a note path within the same vault.
 * Prefers an exact basename match; falls back to a path-suffix match for
 * targets that include a folder (e.g. `People/Alice`). Case-insensitive.
 * Returns null when nothing (or something ambiguous) matches.
 */
export function resolveWikiTarget(
  target: string,
  vault: VaultId,
  notes: readonly ResolvableNote[],
): string | null {
  if (!target) return null;
  const needle = target.toLowerCase().replace(/\.md$/i, '');
  const inVault = notes.filter((n) => n.vault === vault);

  if (needle.includes('/')) {
    const withExt = `${needle}.md`;
    const hits = inVault.filter((n) => n.path.toLowerCase().endsWith(withExt));
    return hits.length === 1 ? (hits[0]?.path ?? null) : null;
  }

  const hits = inVault.filter((n) => n.filename.toLowerCase() === needle);
  if (hits.length === 1) return hits[0]?.path ?? null;
  return null; // no match, or ambiguous (multiple same-named notes)
}

/**
 * Paths of notes (same vault) that link to `targetPath` via a wikilink.
 * `corpus` supplies each candidate's body plus the fields needed to resolve.
 */
export function findBacklinks(
  targetPath: string,
  targetVault: VaultId,
  corpus: readonly (ResolvableNote & { body: string })[],
): string[] {
  const out: string[] = [];
  for (const note of corpus) {
    if (note.path === targetPath || note.vault !== targetVault) continue;
    const links = extractWikiLinks(note.body);
    const hit = links.some((l) => resolveWikiTarget(l.target, targetVault, corpus) === targetPath);
    if (hit) out.push(note.path);
  }
  return out;
}
