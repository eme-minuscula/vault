import { describe, expect, it } from 'vitest';
import { fullText } from '../cache/db';
import { toRecord } from './sync';

/**
 * The vault's core guarantee: a note survives the cache round-trip byte-for-byte.
 * `toRecord` splits raw text into the fields the app indexes on, and `fullText`
 * reassembles what gets written back — so `fullText(toRecord(raw)) === raw` must
 * hold, or an unedited note could be rewritten with a different byte sequence.
 *
 * The pure split/join is covered in doc.test.ts; this pins the property across
 * the actual cache boundary, which a change to `toRecord` or `NoteRecord` could
 * otherwise break silently.
 */
describe('toRecord cache round-trip', () => {
  const cases: [string, string][] = [
    ['frontmatter + trailing newline', '---\ntype: note\ntags: [a, b]\n---\n# Body\n\ntext\n'],
    ['no trailing newline', '---\ntype: note\n---\n# Body'],
    ['no frontmatter', '# Just a body\n\ntext'],
    ['CRLF throughout', '---\r\ntype: note\r\n---\r\n# Body\r\ntext'],
    ['frontmatter only', '---\ntype: note\n---\n'],
    ['body horizontal rule', 'intro\n\n---\n\nmore'],
    ['block-list tags', '---\ntype: r\ntags:\n  - a\n  - b\n---\nbody'],
    ['accents & emoji', '---\ntype: m\n---\nCafè — Mònica 🍳\n'],
    ['empty', ''],
  ];

  for (const [name, raw] of cases) {
    it(`round-trips: ${name}`, () => {
      expect(fullText(toRecord('w/Note.md', 'sha', raw))).toBe(raw);
    });
  }
});
