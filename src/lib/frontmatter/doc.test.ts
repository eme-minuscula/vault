import { describe, expect, it } from 'vitest';
import { replaceBody, setActiveFlag, splitDoc, joinDoc } from './doc';

describe('splitDoc / joinDoc are lossless', () => {
  const cases: [string, string][] = [
    ['with frontmatter + trailing newline', '---\ntype: note\n---\n# Body\n\ntext\n'],
    ['no trailing newline', '---\ntype: note\n---\n# Body'],
    ['no frontmatter', '# Just a body\n\ntext'],
    ['CRLF frontmatter', '---\r\ntype: note\r\n---\r\n# Body\r\ntext'],
    ['frontmatter only, no body', '---\ntype: note\n---\n'],
    ['body horizontal rule not treated as frontmatter', 'text\n\n---\n\nmore'],
    ['empty string', ''],
    ['frontmatter with blank lines and tags list', '---\ntype: r\ntags:\n  - a\n  - b\n---\nbody'],
  ];

  for (const [name, raw] of cases) {
    it(`round-trips: ${name}`, () => {
      const { frontmatter, body } = splitDoc(raw);
      expect(joinDoc(frontmatter, body)).toBe(raw);
    });
  }

  it('splits at the right boundary', () => {
    const { frontmatter, body } = splitDoc('---\ntype: note\n---\nhello');
    expect(frontmatter).toBe('---\ntype: note\n---\n');
    expect(body).toBe('hello');
  });
});

describe('replaceBody', () => {
  it('swaps the body and preserves frontmatter verbatim', () => {
    const raw = '---\ntype: note\ntags: [a]\n---\nold body';
    expect(replaceBody(raw, 'new body')).toBe('---\ntype: note\ntags: [a]\n---\nnew body');
  });
  it('works when there is no frontmatter', () => {
    expect(replaceBody('old', 'new')).toBe('new');
  });
});

describe('setActiveFlag', () => {
  it('updates an existing active field, leaving the rest byte-identical', () => {
    const raw = '---\ntype: daily\nactive: false\ntags: [x]\n---\nbody\n';
    expect(setActiveFlag(raw, true)).toBe('---\ntype: daily\nactive: true\ntags: [x]\n---\nbody\n');
  });

  it('inserts the field after the opening fence when absent', () => {
    const raw = '---\ntype: daily\n---\nbody';
    expect(setActiveFlag(raw, true)).toBe('---\nactive: true\ntype: daily\n---\nbody');
  });

  it('adds a frontmatter block when there is none and flag is on', () => {
    expect(setActiveFlag('just body', true)).toBe('---\nactive: true\n---\njust body');
  });

  it('is a no-op when clearing an absent flag', () => {
    const raw = '---\ntype: daily\n---\nbody';
    expect(setActiveFlag(raw, false)).toBe(raw);
    expect(setActiveFlag('just body', false)).toBe('just body');
  });

  it('preserves CRLF newline style', () => {
    const raw = '---\r\ntype: daily\r\nactive: false\r\n---\r\nbody';
    expect(setActiveFlag(raw, true)).toBe('---\r\ntype: daily\r\nactive: true\r\n---\r\nbody');
  });
});
