/**
 * Minimal, dependency-free frontmatter reader for the vault's controlled schema.
 *
 * The vault deliberately keeps frontmatter minimal (`type:`, `tags:`, `active:`,
 * plus occasional `date:`), so a focused parser is safer than pulling in a full
 * YAML dependency — and, crucially, we retain the *raw* frontmatter block verbatim
 * so that editing (M4) can write files back without reformatting untouched fields.
 *
 * This is a reader, not a YAML engine: it extracts the handful of typed fields the
 * app indexes on and otherwise leaves content untouched.
 */

export interface Frontmatter {
  type: string | null;
  tags: string[];
  active: boolean;
  date: string | null;
}

export interface ParsedNote {
  frontmatter: Frontmatter;
  /** The raw frontmatter block *without* the `---` fences, or null if none. */
  rawFrontmatter: string | null;
  /** Everything after the frontmatter block (the note body). */
  body: string;
  /** First H1, else first non-empty line of the body, trimmed. */
  heading: string | null;
  /** A short plain-text preview of the body for list views. */
  snippet: string;
}

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const SNIPPET_MAX = 200;

export function parseNote(raw: string): ParsedNote {
  const match = FENCE.exec(raw);
  const rawFrontmatter = match ? (match[1] ?? '') : null;
  const body = match ? raw.slice(match[0].length) : raw;
  const frontmatter = rawFrontmatter
    ? parseFrontmatter(rawFrontmatter)
    : { type: null, tags: [], active: false, date: null };

  return {
    frontmatter,
    rawFrontmatter,
    body,
    heading: firstHeading(body),
    snippet: makeSnippet(body),
  };
}

function parseFrontmatter(block: string): Frontmatter {
  const fm: Frontmatter = { type: null, tags: [], active: false, date: null };
  const lines = block.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const kv = /^([A-Za-z0-9_-]+):\s?(.*)$/.exec(line);
    if (!kv) continue;
    const key = (kv[1] ?? '').toLowerCase();
    const value = (kv[2] ?? '').trim();

    switch (key) {
      case 'type':
        fm.type = unquote(value) || null;
        break;
      case 'active':
        fm.active = /^(true|yes)$/i.test(unquote(value));
        break;
      case 'date':
        fm.date = unquote(value) || null;
        break;
      case 'tags': {
        if (value) {
          fm.tags = parseInlineList(value);
        } else {
          // Block list form:
          //   tags:
          //     - a
          //     - b
          const collected: string[] = [];
          let j = i + 1;
          for (; j < lines.length; j++) {
            const item = /^\s*-\s+(.*)$/.exec(lines[j] ?? '');
            if (!item) break;
            const t = unquote((item[1] ?? '').trim());
            if (t) collected.push(t);
          }
          fm.tags = collected;
          i = j - 1;
        }
        break;
      }
    }
  }
  return fm;
}

function parseInlineList(value: string): string[] {
  const inner = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
  return inner
    .split(',')
    .map((s) => unquote(s.trim()))
    .filter(Boolean);
}

function unquote(s: string): string {
  if (s.length >= 2 && (s.startsWith('"') || s.startsWith("'"))) {
    const q = s.charAt(0);
    if (s.endsWith(q)) return s.slice(1, -1);
  }
  return s;
}

/**
 * Remove a leading H1 from a body. The reading view renders the note title
 * itself, so a body that opens with `# Same Title` would show it twice.
 */
export function stripLeadingH1(body: string): string {
  // `#[ \t]+` mirrors firstHeading's `#\s+` so the title we picked and the line
  // we strip agree even when a tab follows the hash.
  const m = /^\s*#[ \t]+[^\n]*(?:\r?\n|$)/.exec(body);
  if (!m) return body;
  return body.slice(m[0].length).replace(/^\r?\n+/, '');
}

function firstHeading(body: string): string | null {
  for (const line of body.split(/\r?\n/)) {
    const h1 = /^#\s+(.*)$/.exec(line.trim());
    if (h1) return (h1[1] ?? '').trim() || null;
    if (line.trim()) return null; // content before any H1 → no leading heading
  }
  return null;
}

function makeSnippet(body: string): string {
  const text = body
    .replace(/^#+\s+/gm, '') // strip heading markers
    .replace(/[*_`>#-]/g, ' ') // strip common markdown punctuation
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1') // wikilink → label
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // md link → text
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > SNIPPET_MAX ? `${text.slice(0, SNIPPET_MAX).trimEnd()}…` : text;
}
