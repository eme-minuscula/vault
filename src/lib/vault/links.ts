import type { NoteRecord } from '../cache/db';
import { pathMeta, type VaultId } from './path';

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
  /** Display title (H1 if present, else filename) — a wikilink may name this. */
  title?: string;
  /** Obsidian `aliases:` — additional names a wikilink may use. */
  aliases?: readonly string[];
}

/** Map cache records to the shape resolution and backlinks work with. */
export function toResolvable(notes: readonly NoteRecord[]): (ResolvableNote & { body: string })[] {
  return notes.map((n) => ({
    path: n.path,
    vault: n.vault,
    filename: pathMeta(n.path).filename,
    title: n.title,
    aliases: n.aliases,
    body: n.body,
  }));
}

export interface WikiResolver {
  /** Resolve a wikilink target to a note path within `vault`, or null. */
  resolve(target: string, vault: VaultId): string | null;
}

/**
 * Build a reusable resolver over a note corpus.
 *
 * A wikilink target is matched, in order, against filename → title → alias, all
 * within the same vault. Each is indexed up front, so the common `[[Name]]` is an
 * O(1) lookup instead of a full-corpus scan — reuse the resolver across many
 * links, since rebuilding it per call turns backlink computation quadratic.
 */
export function buildWikiResolver(notes: readonly ResolvableNote[]): WikiResolver {
  const byName = new Map<string, string[]>(); // `${vault}\n${lower}` -> paths
  const byTitle = new Map<string, string[]>();
  const byAlias = new Map<string, string[]>();
  const byVault = new Map<VaultId, ResolvableNote[]>();

  const add = (map: Map<string, string[]>, vault: VaultId, name: string, path: string) => {
    const key = `${vault}\n${name.toLowerCase()}`;
    const bucket = map.get(key);
    if (bucket) bucket.push(path);
    else map.set(key, [path]);
  };

  for (const n of notes) {
    add(byName, n.vault, n.filename, n.path);
    // A headingless note's title falls back to its filename, so byTitle can
    // duplicate a byName entry. Harmless: byName resolves first, and a same-tier
    // duplicate only ever yields null (never a wrong guess).
    if (n.title) add(byTitle, n.vault, n.title, n.path);
    for (const alias of n.aliases ?? []) add(byAlias, n.vault, alias, n.path);

    const vaultBucket = byVault.get(n.vault);
    if (vaultBucket) vaultBucket.push(n);
    else byVault.set(n.vault, [n]);
  }

  // A tier resolves only on a unique match; an absent or ambiguous one falls
  // through to the next tier (and ultimately to null).
  const unique = (map: Map<string, string[]>, vault: VaultId, needle: string): string | null => {
    const paths = map.get(`${vault}\n${needle}`);
    return paths && paths.length === 1 ? (paths[0] ?? null) : null;
  };

  return {
    resolve(target, vault) {
      if (!target) return null;
      const needle = target.toLowerCase().replace(/\.md$/i, '');

      // Folder-qualified target (`People/Alice`) → path-suffix match. Rare, so a
      // scoped scan is fine; the common cases are indexed.
      if (needle.includes('/')) {
        const withExt = `${needle}.md`;
        const hits = (byVault.get(vault) ?? []).filter((n) =>
          n.path.toLowerCase().endsWith(withExt),
        );
        return hits.length === 1 ? (hits[0]?.path ?? null) : null;
      }

      return (
        unique(byName, vault, needle) ??
        unique(byTitle, vault, needle) ??
        unique(byAlias, vault, needle)
      );
    },
  };
}

/**
 * Resolve a single wikilink target within a vault. Convenience for one-off
 * resolution; when resolving many links, build a {@link WikiResolver} once.
 */
export function resolveWikiTarget(
  target: string,
  vault: VaultId,
  notes: readonly ResolvableNote[],
): string | null {
  return buildWikiResolver(notes).resolve(target, vault);
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
  const resolver = buildWikiResolver(corpus); // built once, not per link
  const out: string[] = [];
  for (const note of corpus) {
    if (note.path === targetPath || note.vault !== targetVault) continue;
    const links = extractWikiLinks(note.body);
    if (links.some((l) => resolver.resolve(l.target, targetVault) === targetPath)) {
      out.push(note.path);
    }
  }
  return out;
}
