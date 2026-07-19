import type { NoteRecord } from '../cache/db';
import type { VaultId } from '../vault/path';
import { toPlainText } from '../frontmatter/parse';

/**
 * Small, dependency-free full-text search over the cached notes.
 *
 * Terms are AND-matched (every term must appear somewhere in a note). Each
 * term scores by the strongest field it hits — title beats tags/type beats
 * body — so the most relevant notes rise. This runs in-memory over the cache;
 * it's plenty fast for a vault of hundreds–low-thousands of notes.
 */

export interface SearchFilters {
  vault?: VaultId;
  type?: string;
  activeOnly?: boolean;
}

export interface SearchHit {
  note: NoteRecord;
  score: number;
}

const WEIGHT = { title: 5, tag: 3, type: 3, name: 2, body: 1 } as const;

export function searchNotes(
  notes: readonly NoteRecord[],
  query: string,
  filters: SearchFilters = {},
  limit = 100,
): SearchHit[] {
  const terms = tokenize(query);

  const filtered = notes.filter(
    (n) =>
      (!filters.vault || n.vault === filters.vault) &&
      (!filters.type || n.type === filters.type) &&
      (!filters.activeOnly || n.active),
  );

  // With no query, this is a pure filter (used by the Active view, type filters).
  if (terms.length === 0) {
    return filtered
      .map((note) => ({ note, score: 0 }))
      .sort((a, b) => a.note.title.localeCompare(b.note.title))
      .slice(0, limit);
  }

  const hits: SearchHit[] = [];
  for (const note of filtered) {
    const fields = {
      title: note.title.toLowerCase(),
      tags: note.tags.join(' ').toLowerCase(),
      type: (note.type ?? '').toLowerCase(),
      name: note.path.toLowerCase(),
      body: note.body.toLowerCase(),
    };
    let total = 0;
    let matchedAll = true;
    for (const term of terms) {
      const s = scoreTerm(term, fields);
      if (s === 0) {
        matchedAll = false;
        break;
      }
      total += s;
    }
    if (matchedAll) hits.push({ note, score: total });
  }

  hits.sort((a, b) => b.score - a.score || a.note.title.localeCompare(b.note.title));
  return hits.slice(0, limit);
}

function scoreTerm(term: string, f: Record<'title' | 'tags' | 'type' | 'name' | 'body', string>) {
  if (f.title.includes(term)) return WEIGHT.title;
  if (f.tags.includes(term)) return WEIGHT.tag;
  if (f.type.includes(term)) return WEIGHT.type;
  if (f.name.includes(term)) return WEIGHT.name;
  if (f.body.includes(term)) return WEIGHT.body;
  return 0;
}

export function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** A plain-text body excerpt centered on the first matching term, for previews. */
export function excerpt(body: string, query: string, radius = 90): string {
  const text = toPlainText(body);
  const terms = tokenize(query);
  const lower = text.toLowerCase();
  let at = -1;
  for (const t of terms) {
    at = lower.indexOf(t);
    if (at !== -1) break;
  }
  if (at === -1) {
    return text.length > radius * 2 ? `${text.slice(0, radius * 2)}…` : text;
  }
  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + radius);
  const slice = text.slice(start, end).trim();
  return `${start > 0 ? '…' : ''}${slice}${end < text.length ? '…' : ''}`;
}
